// The asset library in data/assets.json, with each original kept in data/assets/. A registered
// file is conformed and placed in ComfyUI the first time it's used for a purpose; later uses
// reuse that copy while ComfyUI still has it.

import { randomUUID } from "node:crypto";
import { copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { handleOf, type AssetEntry, type AssetItem, type AssetKind, type Purpose } from "@/lib/assets";
import type { Asset } from "@/lib/engines/specs";
import { DATA_DIR, DRY_RUN } from "./config";
import { storageRoot } from "./storage";
import { comfyFile } from "./connection";
import { ingest } from "./ingest";
import { dirs, ensureDirs, poster, probe } from "./media";
import { STORE } from "./store";
import { writeJson } from "./jsonFile";
import { say } from "@/lib/say";

const FILE = path.join(DATA_DIR, "assets.json");
const KINDS: AssetKind[] = ["character", "object", "location", "style", "clip"];
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};

// One writer at a time: uploads of several files land concurrently.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function load(): Promise<AssetEntry[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as AssetEntry[];
  } catch {
    return [];
  }
}

async function save(list: AssetEntry[]) {
  await writeJson(FILE, list);
  STORE.events.emit("assets", list);
}

export const listAssets = async () => (await load()).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || b.updatedAt - a.updatedAt);

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 40);

function uniqueName(list: AssetEntry[], name: string, except?: string) {
  // Names are what scripts mention, so two assets can't share a handle.
  const taken = new Set(list.filter((e) => e.id !== except).map((e) => handleOf(e.name).toLowerCase()));
  if (!taken.has(handleOf(name).toLowerCase())) return name;
  for (let i = 2; ; i++) if (!taken.has(handleOf(`${name}${i}`).toLowerCase())) return `${name} ${i}`;
}

export function createAsset(input: { name: string; kind: AssetKind; description?: string }): Promise<AssetEntry> {
  return locked(async () => {
    const name = cleanName(input.name);
    if (!name) throw new Error(say("Give the asset a name."));
    if (!KINDS.includes(input.kind)) throw new Error(say("Unknown asset type."));
    const list = await load();
    const now = Date.now();
    const e: AssetEntry = { id: randomUUID().slice(0, 8), name: uniqueName(list, name), kind: input.kind, description: (input.description ?? "").slice(0, 600), items: [], createdAt: now, updatedAt: now };
    await save([e, ...list]);
    return e;
  });
}

export function updateAsset(
  id: string,
  p: Partial<Pick<AssetEntry, "name" | "kind" | "description" | "cover" | "favorite">> & { order?: string[]; labels?: Record<string, string> },
): Promise<AssetEntry> {
  return locked(async () => {
    const list = await load();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error(say("No such asset."));
    if (typeof p.name === "string") {
      const n = cleanName(p.name);
      if (!n) throw new Error(say("Give the asset a name."));
      e.name = uniqueName(list, n, id);
    }
    if (p.kind && KINDS.includes(p.kind)) e.kind = p.kind;
    if (typeof p.description === "string") e.description = p.description.slice(0, 600);
    if (typeof p.cover === "string" && e.items.some((i) => i.id === p.cover)) e.cover = p.cover;
    if (typeof p.favorite === "boolean") e.favorite = p.favorite;
    if (p.order) {
      const rank = new Map(p.order.map((x, i) => [x, i]));
      e.items.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
    }
    if (p.labels) for (const it of e.items) if (it.id in p.labels) it.label = p.labels[it.id].trim().slice(0, 24) || undefined;
    e.updatedAt = Date.now();
    await save(list);
    return e;
  });
}

export function deleteAsset(id: string): Promise<void> {
  return locked(async () => {
    const list = await load();
    const e = list.find((x) => x.id === id);
    if (!e) return;
    await save(list.filter((x) => x.id !== id));
    await Promise.all(e.items.flatMap((it) => [rm(path.join(dirs.assets, it.file), { force: true }), rm(path.join(dirs.assets, `${it.id}.jpg`), { force: true })]));
  });
}

/** Store a file (already on disk) as a new item: copy the original, probe it, make a poster for videos. */
async function makeItem(source: string, fileName: string): Promise<AssetItem> {
  await ensureDirs();
  const id = randomUUID().slice(0, 10);
  const ext = (path.extname(fileName) || path.extname(source) || ".png").toLowerCase();
  const file = `${id}${ext}`;
  const dest = path.join(dirs.assets, file);
  await copyFile(source, dest);
  const mime = MIME[ext] ?? "";
  const p = await probe(dest).catch(() => null);
  // Neither a known media type nor something ffprobe can read: not a picture, clip or sound.
  if (!mime && !p) {
    await rm(dest, { force: true });
    throw new Error(say("“{name}” isn't a picture, clip or audio file.", { name: fileName }));
  }
  const kind: AssetItem["kind"] = mime.startsWith("audio") || (p && !p.width) ? "audio" : mime.startsWith("video") || (p && p.frames > 1 && p.duration > 0) ? "video" : "image";
  const url = `/api/files/assets/${file}`;
  let still: string | undefined = kind === "image" ? url : undefined;
  if (kind === "video") {
    await poster(dest, path.join(dirs.assets, `${id}.jpg`), Math.min(0.5, (p?.duration ?? 1) / 3)).catch(() => {});
    still = `/api/files/assets/${id}.jpg`;
  }
  return { id, kind, file, url, poster: still, width: p?.width || undefined, height: p?.height || undefined, duration: kind === "image" ? undefined : p?.duration || undefined };
}

export async function addItems(id: string, files: { path: string; name: string }[]): Promise<AssetEntry> {
  const items: AssetItem[] = [];
  try {
    for (const f of files) items.push(await makeItem(f.path, f.name));
  } catch (e) {
    // All or nothing: the files already copied for this batch go too.
    await Promise.all(items.flatMap((it) => [rm(path.join(dirs.assets, it.file), { force: true }), rm(path.join(dirs.assets, `${it.id}.jpg`), { force: true })]));
    throw e;
  }
  return locked(async () => {
    const list = await load();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error(say("No such asset."));
    e.items.push(...items);
    e.cover ??= items.find((i) => i.kind === "image")?.id ?? items[0]?.id;
    e.updatedAt = Date.now();
    await save(list);
    return e;
  });
}

/** A file the app already serves (a take, an upload): /api/files/<root>/<name> → its path on disk. */
export function localFile(url: string): string | null {
  const m = /^\/api\/files\/(uploads|media|films|assets)\/([^/?#]+)$/.exec(url.split("?")[0]);
  const name = m ? plainName(m[2]) : null;
  return m && name ? path.join(storageRoot(), m[1], name) : null;
}

/** A URL path segment decoded into a bare file name, or null if it names anything else (%2F, %2e%2e…). */
export function plainName(segment: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return name && name !== "." && name !== ".." && !/[/\\\0]/.test(name) && path.basename(name) === name ? name : null;
}

/** Remove one file. An asset left with no files is removed too (null), since there's nothing to use. */
export function removeItem(id: string, itemId: string): Promise<AssetEntry | null> {
  return locked(async () => {
    const list = await load();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error(say("No such asset."));
    const it = e.items.find((i) => i.id === itemId);
    e.items = e.items.filter((i) => i.id !== itemId);
    if (e.cover === itemId) e.cover = e.items.find((i) => i.kind === "image")?.id ?? e.items[0]?.id;
    e.updatedAt = Date.now();
    await save(e.items.length ? list : list.filter((x) => x.id !== id));
    if (it) await Promise.all([rm(path.join(dirs.assets, it.file), { force: true }), rm(path.join(dirs.assets, `${it.id}.jpg`), { force: true })]);
    return e.items.length ? e : null;
  });
}

async function onComfy(name: string): Promise<boolean> {
  if (DRY_RUN) return true;
  const [sub, file] = name.includes("/") ? [name.slice(0, name.lastIndexOf("/")), name.slice(name.lastIndexOf("/") + 1)] : ["", name];
  const res = await comfyFile(`/view?type=input&filename=${encodeURIComponent(file)}&subfolder=${encodeURIComponent(sub)}`, {
    method: "HEAD",
    timeoutMs: 5000,
  }).catch(() => null);
  return !!res?.ok;
}

/**
 * Items ready for a purpose (ComfyUI file names), labelled with the asset's @handle and grouped
 * by the asset, so a script can mention a character once and mean all of its pictures.
 */
export async function prepareItems(id: string, itemIds: string[] | undefined, purpose: Purpose): Promise<Asset[]> {
  const e = (await load()).find((x) => x.id === id);
  if (!e) throw new Error(say("That asset was deleted."));
  const wanted = itemIds?.length ? e.items.filter((i) => itemIds.includes(i.id)) : e.items;
  const out: Asset[] = [];
  for (const it of wanted) {
    let ready = it.uses?.[purpose];
    if (!ready || !(await onComfy(ready.name))) {
      ready = await ingest(path.join(dirs.assets, it.file), it.label ?? e.name, MIME[path.extname(it.file)] ?? "", purpose, it.url);
      const fresh = ready;
      await locked(async () => {
        const list = await load();
        const cur = list.find((x) => x.id === id)?.items.find((x) => x.id === it.id);
        if (cur) {
          cur.uses = { ...cur.uses, [purpose]: fresh };
          await save(list);
        }
      });
    }
    out.push({ ...ready, label: handleOf(e.name), group: e.id, note: e.description || undefined });
  }
  return out;
}

// The edit of each project in data/sequences.json, so the editor and agents share one cut.
// Keyed like the editor: a project id, or "all" when no project is chosen.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize, sanitize, type Clip } from "@/lib/sequence";
import { DATA_DIR } from "./config";
import { STORE } from "./store";
import { writeJson } from "./jsonFile";
import { say } from "@/lib/say";

const FILE = path.join(DATA_DIR, "sequences.json");
const MAX_CLIPS = 500;

export const isSequenceKey = (key: string) => /^[\w-]{1,40}$/.test(key);

let saving: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, Clip[]>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, Clip[]>;
  } catch {
    return {};
  }
}

export const allSequences = () => load();

export const getSequence = async (key: string) => (await load())[key] ?? [];

/**
 * Save an edit. Takes plain take ids (older saves) or clips; a clip whose end isn't known yet
 * runs to the end of its take when the take's length is.
 */
export async function putSequence(key: string, raw: unknown, origin?: string): Promise<Clip[]> {
  if (!isSequenceKey(key)) throw new Error(say("That isn't a sequence name."));
  if (!Array.isArray(raw)) throw new Error(say("Send the clips as a list."));
  const ids = [...new Set(raw.map((x) => (typeof x === "string" ? x : (x as Clip)?.take)).filter((t): t is string => typeof t === "string"))];
  const jobs = new Map((await Promise.all(ids.map((id) => STORE.get(id)))).flatMap((j) => (j ? [[j.id, j] as const] : [])));
  const source = (t: string) => {
    const m = jobs.get(t)?.meta;
    return m ? { seconds: m.seconds, fps: m.fps || 24, trimHead: m.trimHead } : undefined;
  };
  const clips = normalize(raw.slice(0, MAX_CLIPS), source).map((c) => {
    const { in: start, out } = sanitize(c, source(c.take));
    const join: Clip["join"] = c.join === "dissolve" ? "dissolve" : "cut";
    return { id: String(c.id).slice(0, 24), take: c.take, in: start, out, join, ...(c.muted ? { muted: true } : {}) };
  });
  const write = saving.then(async () => {
    const all = await load();
    all[key] = clips;
    await writeJson(FILE, all);
  });
  saving = write.catch(() => {});
  await write;
  STORE.events.emit("sequence", { key, clips, origin: origin ?? null });
  return clips;
}

/** A deleted take leaves every edit, so no stored cut points at a file that is gone. */
export async function dropTake(take: string) {
  const write = saving.then(async () => {
    const all = await load();
    const changed = Object.entries(all).filter(([, clips]) => clips.some((c) => c.take === take));
    if (!changed.length) return [];
    for (const [key, clips] of changed) all[key] = clips.filter((c) => c.take !== take);
    await writeJson(FILE, all);
    return changed.map(([key]) => key);
  });
  saving = write.then(() => {}, () => {});
  const keys = await write;
  const all = keys.length ? await load() : {};
  for (const key of keys) STORE.events.emit("sequence", { key, clips: all[key] ?? [], origin: null });
}

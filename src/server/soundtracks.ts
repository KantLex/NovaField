// The soundtrack of each project's edit in data/soundtracks.json, keyed like the edits (a project
// id, or "all"), so the editor, other tabs and agents share it.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Soundtrack } from "@/lib/sequence";
import { DATA_DIR } from "./config";
import { writeJson } from "./jsonFile";
import { dirs, probe } from "./media";
import { isSequenceKey } from "./sequences";
import { STORE } from "./store";
import { say } from "@/lib/say";

const FILE = path.join(DATA_DIR, "soundtracks.json");

let saving: Promise<void> = Promise.resolve();

async function load(): Promise<Record<string, Soundtrack>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, Soundtrack>;
  } catch {
    return {};
  }
}

export const allSoundtracks = () => load();

export const getSoundtrack = async (key: string) => (await load())[key] ?? null;

/**
 * The file a soundtrack plays: an audio take's own file, or a file uploaded here for the purpose.
 * Nothing else on disk can be named this way.
 */
export async function soundtrackFile(t: Pick<Soundtrack, "take" | "url">): Promise<string> {
  if (t.take) {
    const job = await STORE.get(t.take);
    const name = job?.status === "done" && job.audio?.startsWith("/api/files/media/") ? path.basename(job.audio) : "";
    const file = name && path.join(dirs.media, name);
    if (!file || !existsSync(file)) throw new Error(say("That take has no finished sound to use as a soundtrack."));
    return file;
  }
  const name = t.url?.startsWith("/api/files/uploads/") ? path.basename(t.url) : "";
  const file = name && path.join(dirs.uploads, name);
  if (!file || !existsSync(file)) throw new Error(say("Upload the soundtrack first (purpose “track”)."));
  return file;
}

/** Save (or with null, remove) an edit's soundtrack. Its length is read from the file itself. */
export async function putSoundtrack(key: string, raw: unknown, origin?: string): Promise<Soundtrack | null> {
  if (!isSequenceKey(key)) throw new Error(say("That isn't a sequence name."));
  let track: Soundtrack | null = null;
  if (raw) {
    const r = raw as Partial<Soundtrack>;
    const source = typeof r.take === "string" && r.take ? { take: r.take } : { url: typeof r.url === "string" ? r.url : "" };
    const p = await probe(await soundtrackFile(source)).catch(() => null);
    if (!p?.hasAudio) throw new Error(say("That file has no sound to use as a soundtrack."));
    track = {
      ...source,
      label: String(r.label ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || say("Soundtrack"),
      start: Math.max(0, Math.min(Number(r.start) || 0, Math.max(0, p.duration - 0.5))),
      mix: r.mix === "under" ? "under" : "replace",
      volume: Math.min(1, Math.max(0, Number.isFinite(Number(r.volume)) ? Number(r.volume) : 1)),
      ...(p.duration > 0 ? { seconds: p.duration } : {}),
    };
  }
  const write = saving.then(async () => {
    const all = await load();
    if (track) all[key] = track;
    else delete all[key];
    await writeJson(FILE, all);
  });
  saving = write.catch(() => {});
  await write;
  STORE.events.emit("soundtrack", { key, track, origin: origin ?? null });
  return track;
}

/** A deleted take stops being any edit's soundtrack. */
export async function dropSoundtrackTake(take: string) {
  const write = saving.then(async () => {
    const all = await load();
    const keys = Object.keys(all).filter((k) => all[k].take === take);
    if (!keys.length) return [];
    for (const k of keys) delete all[k];
    await writeJson(FILE, all);
    return keys;
  });
  saving = write.then(() => {}, () => {});
  for (const key of await write) STORE.events.emit("soundtrack", { key, track: null, origin: null });
}

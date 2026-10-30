// Where NovaField keeps its media: takes, films, uploads and asset files. The small records (jobs,
// projects, assets.json, workflows, settings) stay in data/; every file is addressed relative to the
// storage folder, so moving it keeps every take, film and asset working.
//
// Changing the folder copies everything there, checks every file arrived whole, then switches. The
// old copies are never deleted: the user removes them when they're ready.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "./config";
import { writeJson } from "./jsonFile";
import { say } from "@/lib/say";

const run = promisify(execFile);
const FILE = path.join(DATA_DIR, "storage.json");
export const FOLDERS = ["media", "films", "uploads", "assets"] as const;
export type Folder = (typeof FOLDERS)[number];

const g = globalThis as unknown as { __novaStorage?: string };

/** The folder the media lives in (the project's data/ until the user picks another). */
export function storageRoot(): string {
  if (g.__novaStorage) return g.__novaStorage;
  try {
    const saved = JSON.parse(readFileSync(FILE, "utf8")) as { root?: string };
    if (saved.root && path.isAbsolute(saved.root)) return (g.__novaStorage = saved.root);
  } catch {
    /* no setting yet */
  }
  return (g.__novaStorage = DATA_DIR);
}

export const folderPath = (f: Folder) => path.join(storageRoot(), f);

async function walk(dir: string, base = dir): Promise<{ rel: string; size: number }[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: { rel: string; size: number }[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else if (e.isFile()) out.push({ rel: path.relative(base, p), size: (await stat(p)).size });
  }
  return out;
}

export interface StorageInfo {
  root: string;
  isDefault: boolean;
  /** Bytes per folder, and in all. */
  usage: Record<Folder, number> & { total: number };
  /** Free bytes on the drive holding the folder, when the system can say. */
  free: number | null;
}

async function freeBytes(dir: string) {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  const root = storageRoot();
  const usage = { total: 0 } as StorageInfo["usage"];
  for (const f of FOLDERS) {
    usage[f] = (await walk(path.join(root, f))).reduce((n, x) => n + x.size, 0);
    usage.total += usage[f];
  }
  return { root, isDefault: path.resolve(root) === path.resolve(DATA_DIR), usage, free: await freeBytes(existsSync(root) ? root : DATA_DIR) };
}

export class StorageError extends Error {}

/**
 * Where a chosen folder's files go: the folder itself when it's already a NovaField storage folder
 * (or named NovaField), otherwise a NovaField folder inside it, so a pick like the Desktop stays tidy.
 */
export function targetFor(chosen: string): string {
  const dir = path.resolve(chosen);
  if (path.basename(dir) === "NovaField" || FOLDERS.some((f) => existsSync(path.join(dir, f)))) return dir;
  return path.join(dir, "NovaField");
}

/**
 * Copy the media folders from one storage folder to another and check every file arrived whole.
 * Files already at the destination (switching back to an earlier folder) are kept, not overwritten.
 */
export async function copyMedia(from: string, to: string): Promise<{ files: number; bytes: number }> {
  const files = (await Promise.all(FOLDERS.map(async (f) => (await walk(path.join(from, f))).map((x) => ({ ...x, rel: path.join(f, x.rel) }))))).flat();
  const bytes = files.reduce((n, x) => n + x.size, 0);
  const free = await freeBytes(to);
  if (free !== null && free < bytes * 1.05 + 50e6) throw new StorageError(say("Not enough space there: NovaField needs about {need} MB and the drive has {free} MB free.", { need: Math.ceil(bytes / 1e6), free: Math.floor(free / 1e6) }));
  for (const f of FOLDERS) {
    if (existsSync(path.join(from, f))) await cp(path.join(from, f), path.join(to, f), { recursive: true, force: false, errorOnExist: false });
    else await mkdir(path.join(to, f), { recursive: true });
  }
  const missing: string[] = [];
  for (const x of files) {
    const s = await stat(path.join(to, x.rel)).catch(() => null);
    if (!s || s.size !== x.size) missing.push(x.rel);
  }
  if (missing.length) throw new StorageError(
      say(missing.length === 1 ? "A file didn't copy completely ({files}). NovaField kept using the old folder; nothing was removed." : "{n} files didn't copy completely ({files}). NovaField kept using the old folder; nothing was removed.", {
        n: missing.length,
        files: missing.slice(0, 3).join(", "),
      }),
    );
  return { files: files.length, bytes };
}

/** Copy every media file to `chosen`, check them, then use it. Nothing is deleted anywhere. */
export async function moveStorage(chosen: string): Promise<{ root: string; files: number; bytes: number; previous: string }> {
  if (!chosen || !path.isAbsolute(chosen)) throw new StorageError(say("Choose a full folder path, like /Volumes/Footage."));
  const from = storageRoot();
  const to = targetFor(chosen);
  if (path.resolve(to) === path.resolve(from)) throw new StorageError(say("That's already where NovaField keeps its files."));
  for (const f of FOLDERS) {
    const src = path.resolve(from, f);
    if (path.resolve(to) === src || path.resolve(to).startsWith(src + path.sep)) throw new StorageError(say("Choose a folder outside NovaField's current media folders."));
  }
  try {
    await mkdir(to, { recursive: true });
  } catch {
    throw new StorageError(say("NovaField can't create or write to that folder. Check the drive is connected and you have permission."));
  }
  const copied = await copyMedia(from, to);
  await writeJson(FILE, { root: to }, { indent: 2 });
  g.__novaStorage = to;
  return { root: to, ...copied, previous: from };
}

/** Ask the system for a folder (this computer runs the app). Null when cancelled or unsupported. */
export async function chooseFolder(): Promise<string | null> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await run("osascript", ["-e", 'POSIX path of (choose folder with prompt "Where should NovaField keep its takes, films and uploads?")'], { timeout: 300_000 });
      return stdout.trim().replace(/\/$/, "") || null;
    }
    if (process.platform === "win32") {
      const ps =
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Where should NovaField keep its takes?'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }";
      const { stdout } = await run("powershell", ["-NoProfile", "-Command", ps], { timeout: 300_000 });
      return stdout.trim() || null;
    }
    const { stdout } = await run("zenity", ["--file-selection", "--directory", "--title=Where should NovaField keep its takes?"], { timeout: 300_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Show the storage folder in Finder / Explorer. */
export async function revealStorage() {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  await run(cmd, [root]).catch(() => {});
}

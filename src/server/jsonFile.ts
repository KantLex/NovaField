// Saving JSON so a crash, a full disk or a second writer never leaves a half-written file: write a
// temp file with a unique name, then rename it over the old one (atomic on the same drive).

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeJson(file: string, data: unknown, opts: { indent?: number; mode?: number } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, opts.indent ?? 1), opts.mode !== undefined ? { mode: opts.mode } : undefined);
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

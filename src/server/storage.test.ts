import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyMedia, moveStorage, StorageError, targetFor } from "./storage";

const temps: string[] = [];
const temp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "nf-storage-"));
  temps.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(temps.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("storage folder", () => {
  it("copies every media file, keeps the originals, and doesn't overwrite what's already there", async () => {
    const from = await temp();
    const to = await temp();
    await mkdir(path.join(from, "media"), { recursive: true });
    await mkdir(path.join(from, "films"), { recursive: true });
    await writeFile(path.join(from, "media", "a1.mp4"), "take");
    await writeFile(path.join(from, "media", "a1_strip.jpg"), "strip");
    await writeFile(path.join(from, "films", "f.mp4"), "film");
    await mkdir(path.join(to, "media"), { recursive: true });
    await writeFile(path.join(to, "media", "old.mp4"), "kept");

    const r = await copyMedia(from, to);
    expect(r).toEqual({ files: 3, bytes: 13 });
    expect(await readFile(path.join(to, "media", "a1_strip.jpg"), "utf8")).toBe("strip");
    expect(await readFile(path.join(to, "media", "old.mp4"), "utf8")).toBe("kept");
    // Nothing is removed from the old folder.
    expect(existsSync(path.join(from, "media", "a1.mp4"))).toBe(true);
    // Folders that didn't exist yet are made, so the app can write into them.
    expect(existsSync(path.join(to, "uploads"))).toBe(true);
  });

  it("puts files in a NovaField folder unless the pick already is one", async () => {
    const d = await temp();
    expect(targetFor(d)).toBe(path.join(d, "NovaField"));
    await mkdir(path.join(d, "media"));
    expect(targetFor(d)).toBe(d);
    expect(targetFor(path.join(d, "x", "NovaField"))).toBe(path.join(d, "x", "NovaField"));
  });

  it("refuses a relative path before touching anything", async () => {
    await expect(moveStorage("relative/path")).rejects.toBeInstanceOf(StorageError);
  });
});

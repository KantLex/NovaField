import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJson } from "./jsonFile";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("saving JSON", () => {
  it("survives many saves of one file at once, leaving a whole file and no temp files", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "nf-json-"));
    const file = path.join(dir, "deep", "jobs.json");
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJson(file, { i, items: Array.from({ length: 200 }, (_, j) => j) })));
    const saved = JSON.parse(await readFile(file, "utf8")) as { i: number; items: number[] };
    expect(saved.items).toHaveLength(200);
    expect(await readdir(path.dirname(file))).toEqual(["jobs.json"]);
  });
});

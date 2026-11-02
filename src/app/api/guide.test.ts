// The 3D previs guide: frames from the browser become H3's reference video, with real ffmpeg.
// Runs in a throwaway data folder (each test file has its own process), with ComfyUI out of reach.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
process.env.NOVAFIELD_DRY_RUN = "1";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const root = await mkdtemp(path.join(os.tmpdir(), "nf-guide-"));
process.chdir(root);
const stills = path.join(root, "stills");
await mkdir(stills, { recursive: true });
if (hasFfmpeg) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:r=24:d=2.5", path.join(stills, "%04d.jpg")]);

const post = async (frames: Blob[], fps = 24) => {
  const { POST } = await import("./guide/route");
  const form = new FormData();
  frames.forEach((f, i) => form.append("frame", f, `${i}.jpg`));
  form.append("fps", String(fps));
  return POST(new Request("http://localhost/api/guide", { method: "POST", body: form }));
};
const jpegs = async () => Promise.all((await readdir(stills)).sort().map(async (n) => new Blob([await readFile(path.join(stills, n))], { type: "image/jpeg" })));

describe.skipIf(!hasFfmpeg)("the 3D previs guide", () => {
  it("turns the frames into an H3 reference video and cleans up the stills", async () => {
    const res = await post(await jpegs());
    expect(res.status).toBe(200);
    const asset = await res.json();
    expect(asset).toMatchObject({ kind: "video", fps: 24, width: 160, height: 90 });
    // H3 takes 17k+5 frames: 60 drawn become 56 (a shot's own guide already has a valid count).
    expect(asset.frames).toBe(56);
    expect(existsSync(path.join(root, "data", asset.url.replace("/api/files/", "")))).toBe(true);
    expect((await readdir(path.join(root, "data", "uploads"))).filter((n) => n.endsWith("_stills"))).toEqual([]);
  });

  it("turns away too few frames, and anything that isn't a JPEG", async () => {
    expect((await post((await jpegs()).slice(0, 20))).status).toBe(400);
    const frames = await jpegs();
    frames[3] = new Blob(["<svg/>"], { type: "image/jpeg" });
    const res = await post(frames);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JPEG/);
    expect((await post(await jpegs(), 0)).status).toBe(400);
    // Counted in seconds, not frames: 60 frames at 60 fps is one second.
    expect((await post(await jpegs(), 60)).status).toBe(400);
  });
});

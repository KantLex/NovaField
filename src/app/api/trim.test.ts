// Choosing another part of a clip for Henshin: cut again from the original, with real ffmpeg.
// Runs in a throwaway data folder (each test file has its own process), with ComfyUI out of reach.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
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

const root = await mkdtemp(path.join(os.tmpdir(), "nf-trim-"));
process.chdir(root);
const uploads = path.join(root, "data", "uploads");
await mkdir(uploads, { recursive: true });
if (hasFfmpeg) execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=30:d=12", "-pix_fmt", "yuv420p", path.join(uploads, "long.mp4")]);

const trim = async (body: object) => {
  const { POST } = await import("./trim/route");
  return POST(new Request("http://localhost/api/trim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

describe.skipIf(!hasFfmpeg)("choosing a part of a clip", () => {
  it("cuts the part asked for and remembers the original", async () => {
    const res = await trim({ url: "/api/files/uploads/long.mp4", purpose: "h3", start: 4, seconds: 3, label: "Long take" });
    expect(res.status).toBe(200);
    const clip = await res.json();
    // H3 takes 17k+5 frames: 3 s at 24 fps (72) becomes 56.
    expect(clip).toMatchObject({ kind: "video", fps: 24, frames: 56, label: "Long take" });
    expect(clip.source.url).toBe("/api/files/uploads/long.mp4");
    expect(clip.source.start).toBe(4);
    expect(clip.source.duration).toBeCloseTo(12, 0);
  });

  it("gives Wan its 81 frames from any start, and never runs past the end", async () => {
    const clip = await (await trim({ url: "/api/files/uploads/long.mp4", purpose: "wan", start: 6 })).json();
    expect(clip).toMatchObject({ fps: 16, frames: 81 });
    const late = await (await trim({ url: "/api/files/uploads/long.mp4", purpose: "wan", start: 11 })).json();
    // The latest start leaves 2.4 s, so the part is shorter than 5 s.
    expect(late.source.start).toBeLessThanOrEqual(9.6);
    expect(late.frames).toBeLessThan(81);
  });

  it("turns away files it doesn't keep, missing originals and parts too short", async () => {
    expect((await trim({ url: "/etc/passwd", purpose: "h3", start: 0 })).status).toBe(400);
    expect((await trim({ url: "/api/files/uploads/../long.mp4", purpose: "h3", start: 0 })).status).toBe(400);
    expect((await trim({ url: "/api/files/uploads/gone.mp4", purpose: "h3", start: 0 })).status).toBe(404);
    expect((await trim({ url: "/api/files/uploads/long.mp4", purpose: "h3", start: 0, seconds: 1 })).status).toBe(400);
    expect((await trim({ url: "/api/files/uploads/long.mp4", purpose: "image", start: 0 })).status).toBe(400);
  });
});

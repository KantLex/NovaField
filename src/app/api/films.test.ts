// Assembling a film with a soundtrack, with real ffmpeg on tiny generated clips. Runs in a
// throwaway data folder (each test file has its own process).

import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const root = await mkdtemp(path.join(os.tmpdir(), "nf-films-"));
process.chdir(root);
const data = path.join(root, "data");
await mkdir(path.join(data, "media"), { recursive: true });
await mkdir(path.join(data, "uploads"), { recursive: true });

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const probe = (file: string) =>
  JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8" })) as {
    streams: { codec_type: string }[];
    format: { duration: string };
  };
/** Mean loudness of a file's sound in dB. */
const loudness = (file: string) => Number(/mean_volume: (-?[\d.]+) dB/.exec(spawnSync("ffmpeg", ["-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1] ?? NaN);

if (hasFfmpeg) {
  for (const id of ["a", "b"]) ff("-f", "lavfi", "-i", "color=c=gray:s=320x180:r=24:d=2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(data, "media", `${id}.mp4`));
  ff("-f", "lavfi", "-i", "sine=frequency=440:duration=10", "-c:a", "pcm_s16le", path.join(data, "uploads", "song.wav"));
  const job = (id: string) => ({ id, kind: "shot", title: id, spec: { kind: "shot" }, status: "done", createdAt: 1, updatedAt: 1, progress: { stage: "Wrapped", pct: 1 }, video: `/api/files/media/${id}.mp4`, meta: { seconds: 2, fps: 24, width: 320, height: 180, frames: 48 } });
  await writeFile(path.join(data, "jobs.json"), JSON.stringify([job("a"), job("b")]));
}

// Frames are only placed in ComfyUI outside a dry run; there's no ComfyUI here.
process.env.NOVAFIELD_DRY_RUN = "1";
const films = await import("./films/route");
const frames = await import("./jobs/[id]/frame/route");
const post = (body: unknown) => films.POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const clips = [
  { id: "c1", take: "a", in: 0, out: 2 },
  { id: "c2", take: "b", in: 0, out: 2 },
];
const fileOf = (url: string) => path.join(data, "films", path.basename(url));

describe.skipIf(!hasFfmpeg)("a film with a soundtrack", () => {
  it("lays the music over the whole cut, as long as the picture", async () => {
    const r = await post({ clips, soundtrack: { url: "/api/files/uploads/song.wav", start: 3 } });
    expect(r.status).toBe(200);
    const out = fileOf(((await r.json()) as { url: string }).url);
    const p = probe(out);
    expect(Number(p.format.duration)).toBeCloseTo(4, 0);
    expect(p.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
    // The takes are silent, so any sound is the music.
    expect(loudness(out)).toBeGreaterThan(-30);
  });

  it("keeps the takes' sound alone without a soundtrack", async () => {
    const out = fileOf(((await (await post({ clips })).json()) as { url: string }).url);
    expect(loudness(out)).toBeLessThan(-80);
  });

  it("plays it quieter at a lower volume", async () => {
    const full = fileOf(((await (await post({ clips, soundtrack: { url: "/api/files/uploads/song.wav" } })).json()) as { url: string }).url);
    const soft = fileOf(((await (await post({ clips, soundtrack: { url: "/api/files/uploads/song.wav", volume: 0.25, mix: "under" } })).json()) as { url: string }).url);
    expect(loudness(soft)).toBeLessThan(loudness(full) - 6);
  });

  it("only takes a file from the uploads folder", async () => {
    for (const url of ["/api/files/uploads/missing.wav", "/etc/passwd", "/api/files/uploads/../jobs.json"]) expect((await post({ clips, soundtrack: { url } })).status).toBe(400);
  });
});

describe.skipIf(!hasFfmpeg)("a frame of a take", () => {
  const grab = async (body?: unknown) =>
    frames.POST(new Request("http://x", { method: "POST", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ id: "a" }) } as never);

  it("is the last frame by default, as the Studio's Continue from last frame uses it", async () => {
    const f = (await (await grab()).json()) as { url: string; width: number; label: string };
    expect(f.url).toBe("/api/files/media/a_last.png");
    expect(f.width).toBe(320);
    expect(probe(path.join(data, "media", "a_last.png")).streams[0].codec_type).toBe("video");
  });

  it("can be any moment, as a separate picture", async () => {
    const f = (await (await grab({ at: 1.25 })).json()) as { url: string; label: string };
    expect(f.url).toBe("/api/files/media/a_f1250.png");
    expect(f.label).toBe("Frame at 1.25 s");
    // Past the end is the last frame.
    expect(((await (await grab({ at: 99 })).json()) as { url: string }).url).toBe("/api/files/media/a_last.png");
  });
});

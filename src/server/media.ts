// Local ffmpeg work: conform uploads to what each model wants, posters, tails, assembly.

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { FFMPEG, FFPROBE } from "./config";
import { folderPath } from "./storage";

const run = promisify(execFile);

/** The media folders, wherever the user keeps them (Settings → Storage). */
export const dirs = {
  get uploads() {
    return folderPath("uploads");
  },
  get media() {
    return folderPath("media");
  },
  get films() {
    return folderPath("films");
  },
  get assets() {
    return folderPath("assets");
  },
};

export async function ensureDirs() {
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
}

export interface Probe {
  width: number;
  height: number;
  duration: number;
  fps: number;
  frames: number;
  hasAudio: boolean;
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  const j = JSON.parse(stdout) as {
    streams: { codec_type: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; tags?: { rotate?: string } }[];
    format: { duration?: string };
  };
  const v = j.streams.find((s) => s.codec_type === "video");
  const [n, d] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  const fps = d ? n / d : 0;
  const duration = Number(j.format.duration ?? 0);
  const frames = Number(v?.nb_frames) || Math.round(duration * fps);
  return { width: v?.width ?? 0, height: v?.height ?? 0, duration, fps, frames, hasAudio: j.streams.some((s) => s.codec_type === "audio") };
}

const ffmpeg = (args: string[]) => run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 26 });

/** H3 reference video: 24 fps, ≤ 15 s, cut to a valid 17k+5 frame count, long edge ≤ 1280. */
export async function conformForH3(input: string, output: string, frames: number) {
  await ffmpeg([
    "-i", input,
    "-vf", "fps=24,scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))':flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-frames:v", String(frames),
    "-t", String(frames / 24),
    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    output,
  ]);
}

/** Wan source: 16 fps, exactly width×height (cover crop), `frames` frames. */
export async function conformForWan(input: string, output: string, width: number, height: number, frames: number) {
  await ffmpeg([
    "-i", input,
    "-vf", `fps=16,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`,
    "-frames:v", String(frames),
    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    output,
  ]);
}

export async function poster(video: string, output: string, atSeconds = 0.4) {
  await ffmpeg(["-ss", String(atSeconds), "-i", video, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", output]);
}

/** A strip of evenly spaced frames, used for hover-scrubbing in the library. */
export async function filmstrip(video: string, output: string, frames: number, count = 10) {
  const step = Math.max(1, Math.floor(frames / count));
  await ffmpeg(["-i", video, "-vf", `select='not(mod(n\\,${step}))',scale=240:-2,tile=${count}x1`, "-frames:v", "1", "-q:v", "4", output]);
}

/** The last `frames` frames at 24 fps (with sound), for continuing a take. */
export async function tail(video: string, output: string, frames: number) {
  const p = await probe(video);
  const start = Math.max(0, p.duration - frames / 24);
  await ffmpeg([
    "-ss", start.toFixed(4), "-i", video,
    "-vf", "fps=24", "-frames:v", String(frames), "-t", (frames / 24).toFixed(4),
    "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", "-c:a", "aac", output,
  ]);
}

export async function lastFrame(video: string, output: string) {
  await ffmpeg(["-sseof", "-0.1", "-i", video, "-frames:v", "1", "-update", "1", output]);
}

/** One full-size frame, `atSeconds` into a video. */
export async function frameAt(video: string, output: string, atSeconds: number) {
  await ffmpeg(["-ss", atSeconds.toFixed(3), "-i", video, "-frames:v", "1", "-update", "1", output]);
}

/** One clip of an edit: a stretch of a take's file, how it joins the one before, and its sound. */
export interface EditPart {
  file: string;
  in: number;
  out: number;
  /** Seconds of dissolve from the clip before (0 for a cut). */
  fadeIn: number;
  muted?: boolean;
}

/**
 * Music laid over a whole film: from `start` seconds into the file. "replace" makes it the only
 * sound; "under" keeps the takes' own sound, lowered, beneath it. It fades out over the last second.
 */
export interface Soundtrack {
  file: string;
  start?: number;
  mix?: "replace" | "under";
  /** 0–1, default 1. */
  volume?: number;
}

/**
 * Cut an edit into one film: each clip trimmed to its in and out, conformed to one size at 24 fps,
 * joined by cuts or dissolves (picture and sound together), with an optional soundtrack over it all.
 * Re-encodes for clean joins.
 */
export async function assemble(parts: EditPart[], output: string, size: { width: number; height: number }, soundtrack?: Soundtrack) {
  const inputs = parts.flatMap((p) => ["-i", p.file]);
  const probes = await Promise.all(parts.map((p) => probe(p.file)));
  const filters: string[] = [];
  parts.forEach((p, i) => {
    const out = Math.min(p.out, probes[i].duration || p.out);
    const len = Math.max(0.04, out - p.in);
    const span = `start=${p.in.toFixed(4)}:end=${out.toFixed(4)}`;
    filters.push(
      `[${i}:v]trim=${span},setpts=PTS-STARTPTS,fps=24,scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,settb=AVTB[v${i}]`,
    );
    filters.push(
      probes[i].hasAudio && !p.muted
        ? // Sound padded or cut to the picture's exact length, so later clips can't drift out of sync.
          `[${i}:a]atrim=${span},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${len.toFixed(4)}[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${len.toFixed(4)}[a${i}]`,
    );
  });
  // Fold the clips together left to right: a dissolve overlaps the two, a cut butts them.
  // (Every clip shares one time base, so a dissolve can follow a cut.)
  let v = "v0";
  let a = "a0";
  let length = Math.max(0.04, Math.min(parts[0].out, probes[0].duration || parts[0].out) - parts[0].in);
  for (let i = 1; i < parts.length; i++) {
    const len = Math.max(0.04, Math.min(parts[i].out, probes[i].duration || parts[i].out) - parts[i].in);
    const d = Math.min(parts[i].fadeIn, length / 2, len / 2);
    if (d > 0.02) {
      filters.push(`[${v}][v${i}]xfade=transition=fade:duration=${d.toFixed(4)}:offset=${(length - d).toFixed(4)}[vx${i}]`);
      filters.push(`[${a}][a${i}]acrossfade=d=${d.toFixed(4)}[ax${i}]`);
      length += len - d;
    } else {
      filters.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[vx${i}][ax${i}]`);
      length += len;
    }
    v = `vx${i}`;
    a = `ax${i}`;
  }
  if (soundtrack) {
    const n = parts.length;
    inputs.push("-i", soundtrack.file);
    const fadeAt = Math.max(0, length - 1);
    filters.push(
      `[${n}:a]atrim=start=${(soundtrack.start ?? 0).toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${(soundtrack.volume ?? 1).toFixed(3)},apad,atrim=duration=${length.toFixed(4)},afade=t=out:st=${fadeAt.toFixed(4)}:d=1[music]`,
    );
    if (soundtrack.mix === "under") {
      filters.push(`[${a}]volume=0.35[takes]`, `[takes][music]amix=inputs=2:duration=first:normalize=0[mixed]`);
      a = "mixed";
    } else {
      // ffmpeg won't leave a stream unused: the takes' sound goes nowhere.
      filters.push(`[${a}]anullsink`);
      a = "music";
    }
  }
  await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", `[${v}]`, "-map", `[${a}]`, "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
}

/** Dry-run stand-in for a render: a drifting film-toned gradient with grain and a soft tone. */
export async function placeholder(output: string, o: { width: number; height: number; seconds: number; fps: number; seed: number }) {
  const palettes = [
    ["0x1d1a22", "0xb06a3c", "0x3d5a8c", "0xf6dcae"],
    ["0x0f2a33", "0xc47a45", "0x6f8a76", "0xffd9a8"],
    ["0x060b1a", "0x3d5a8c", "0x9b5e8c", "0xc9dcf5"],
  ];
  const c = palettes[o.seed % palettes.length];
  const d = o.seconds.toFixed(3);
  await ffmpeg([
    "-f", "lavfi", "-i",
    `gradients=s=${o.width}x${o.height}:r=${o.fps}:d=${d}:c0=${c[0]}:c1=${c[1]}:c2=${c[2]}:c3=${c[3]}:n=4:speed=0.012:type=radial:seed=${o.seed % 100000},format=yuv420p,noise=c0s=8:c0f=t,vignette=PI/4`,
    "-f", "lavfi", "-i", `sine=frequency=${180 + (o.seed % 5) * 40}:duration=${d}`,
    "-af", "volume=0.15",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", output,
  ]);
}

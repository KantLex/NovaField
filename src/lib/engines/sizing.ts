// Resolution and frame-count rules for the video models on the home GPU.

import type { Aspect, Quality } from "./specs";

export const ASPECTS: { id: Aspect; label: string; ratio: number }[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "2.39:1", label: "Scope", ratio: 2.39 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
];

export const QUALITY: Record<Quality, { label: string; note: string; megapixels: number; tiled: boolean }> = {
  draft: { label: "Draft", note: "480p, about a minute", megapixels: 0.41, tiled: false },
  studio: { label: "Studio", note: "720p, a few minutes", megapixels: 0.9, tiled: false },
  master: { label: "Master", note: "1080p, up to 6.5 s, ~10 min", megapixels: 2.08, tiled: true },
};

/** MiniMax H3 breaks past roughly this many pixel-frames on a 24 GB GPU. */
export const H3_PIXEL_FRAME_LIMIT = 330_000_000;
export const H3_FPS = 24;

export function sizeFor(aspect: Aspect, megapixels: number, step: number): { width: number; height: number } {
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? 16 / 9;
  const px = megapixels * 1_000_000;
  const width = Math.max(step * 4, Math.round(Math.sqrt(px * ratio) / step) * step);
  const height = Math.max(step * 4, Math.round(Math.sqrt(px / ratio) / step) * step);
  return { width, height };
}

/** Same expression as the H3 workflows: round to 24 fps frames, then snap up to 17k + 5. */
export function h3Frames(seconds: number): number {
  const f = Math.max(5, Math.round(seconds * H3_FPS));
  return f + ((5 - (f % 17)) % 17 + 17) % 17;
}

/** Largest valid H3 length that fits inside `frames` source frames. */
export function h3FramesAtMost(frames: number): number {
  if (frames < 22) return 5;
  return Math.floor((frames - 5) / 17) * 17 + 5;
}

export interface H3Plan {
  width: number;
  height: number;
  frames: number;
  seconds: number;
  tiled: boolean;
  clamped: boolean;
}

export function planH3(aspect: Aspect, quality: Quality, seconds: number): H3Plan {
  const q = QUALITY[quality];
  const { width, height } = sizeFor(aspect, q.megapixels, 32);
  let frames = h3Frames(Math.min(15, Math.max(2, seconds)));
  let clamped = false;
  while (width * height * frames > H3_PIXEL_FRAME_LIMIT && frames > 22) {
    frames -= 17;
    clamped = true;
  }
  return { width, height, frames, seconds: frames / H3_FPS, tiled: q.tiled, clamped };
}

/** Wan 2.1 works at ~0.4 MP in steps of 16, 16 fps, 4k + 1 frames. */
export function planWan(aspect: Aspect): { width: number; height: number; frames: number; fps: number } {
  const fixed: Record<Aspect, [number, number]> = {
    "16:9": [832, 480],
    "9:16": [480, 832],
    "1:1": [624, 624],
    "2.39:1": [960, 400],
    "4:3": [720, 544],
  };
  const [width, height] = fixed[aspect];
  return { width, height, frames: 81, fps: 16 };
}

export function nearestAspect(width: number, height: number): Aspect {
  const r = width / height;
  let best = ASPECTS[0];
  for (const a of ASPECTS) if (Math.abs(Math.log(a.ratio / r)) < Math.abs(Math.log(best.ratio / r))) best = a;
  return best.id;
}

export const timecode = (frames: number, fps: number) => {
  const total = Math.max(0, Math.round(frames));
  const s = Math.floor(total / fps);
  const f = total % fps;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};

/** How long a shot runs to follow a previs clip: 2 to 15 s, on half seconds. */
export const previsSeconds = (clip: { duration?: number }) => Math.min(15, Math.max(2, Math.round((clip.duration ?? 5) * 2) / 2));

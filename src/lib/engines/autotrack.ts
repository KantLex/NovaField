// Following a boxed object through a clip, for Henshin's Replace: from one box, find it in every
// frame by matching what it looks like (zero-mean normalised cross-correlation on small colour
// frames, weighted to the middle of the box where the thing is, near where it last was, at a few
// sizes), then keep only the keyframes the GPU's smoothstep needs to retrace that path. Pure maths
// on pixels: the browser decodes the frames.

import type { BoxKey } from "./specs";
import { boxAt } from "./tracks";

/** A frame in colour, `w`×`h`, RGB 0–1 interleaved, row by row. */
export interface Pic {
  w: number;
  h: number;
  data: Float32Array;
}

/** A box in 0–1 of the frame. */
export type Box = Omit<BoxKey, "f">;

/** The template's longer side, in samples: plenty to recognise a thing, cheap to compare. */
const TEMPLATE = 24;
/** Below this match score the thing is taken as lost (hidden, out of frame, changed past recognition). */
export const LOST_BELOW = 0.45;
/** However well it matches how it looks lately, it must still look somewhat like it did when boxed. */
const FIRST_BELOW = 0.25;
const SCALES = [0.96, 1, 1.04];

interface Template {
  /** Weighted, mean-removed colour samples on a tw×th grid over the box. */
  t: Float32Array;
  tw: number;
  th: number;
  /** Their spread (root of the sum of squares), for the normalised score. */
  norm: number;
}

type Rect = { x: number; y: number; w: number; h: number };

/** Per sample, how much it counts: most in the middle of the box, little at its edges (often background). */
const weightCache = new Map<string, Float32Array>();
function weights(tw: number, th: number): Float32Array {
  const id = `${tw}x${th}`;
  let w = weightCache.get(id);
  if (!w) {
    w = new Float32Array(tw * th);
    for (let j = 0; j < th; j++)
      for (let i = 0; i < tw; i++) {
        const u = (i + 0.5) / tw - 0.5;
        const v = (j + 0.5) / th - 0.5;
        w[j * tw + i] = Math.sqrt(Math.exp(-(u * u + v * v) / (2 * 0.28 * 0.28)));
      }
    weightCache.set(id, w);
  }
  return w;
}

/** Sample frame `g` over box `b` (pixels) onto a tw×th grid, bilinear, then weight and centre it per channel. */
function sample(g: Pic, b: Rect, tw: number, th: number): { v: Float32Array; norm: number } {
  const out = new Float32Array(tw * th * 3);
  const W = g.w;
  for (let j = 0; j < th; j++) {
    const y = Math.min(g.h - 1.001, Math.max(0, b.y + ((j + 0.5) / th) * b.h - 0.5));
    const y0 = Math.floor(y);
    const fy = y - y0;
    for (let i = 0; i < tw; i++) {
      const x = Math.min(W - 1.001, Math.max(0, b.x + ((i + 0.5) / tw) * b.w - 0.5));
      const x0 = Math.floor(x);
      const fx = x - x0;
      const p = (y0 * W + x0) * 3;
      const q = p + W * 3;
      for (let c = 0; c < 3; c++) {
        const top = g.data[p + c] * (1 - fx) + g.data[p + 3 + c] * fx;
        const bot = g.data[q + c] * (1 - fx) + g.data[q + 3 + c] * fx;
        out[(j * tw + i) * 3 + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  const wt = weights(tw, th);
  let sw = 0;
  for (const x of wt) sw += x * x;
  let ss = 0;
  for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let k = 0; k < tw * th; k++) m += wt[k] * wt[k] * out[k * 3 + c];
    m /= sw;
    for (let k = 0; k < tw * th; k++) {
      const d = (out[k * 3 + c] - m) * wt[k];
      out[k * 3 + c] = d;
      ss += d * d;
    }
  }
  return { v: out, norm: Math.sqrt(ss) };
}

function templateOf(g: Pic, b: Rect): Template {
  const k = TEMPLATE / Math.max(b.w, b.h);
  const tw = Math.max(4, Math.round(b.w * k));
  const th = Math.max(4, Math.round(b.h * k));
  const { v, norm } = sample(g, b, tw, th);
  return { t: v, tw, th, norm };
}

/** How well the template matches frame `g` over box `b`: -1 to 1 (flat patches score 0). */
function score(g: Pic, tpl: Template, b: Rect): number {
  const { v, norm } = sample(g, b, tpl.tw, tpl.th);
  if (norm < 1e-6 || tpl.norm < 1e-6) return 0;
  let dot = 0;
  for (let i = 0; i < v.length; i++) dot += v[i] * tpl.t[i];
  return dot / (norm * tpl.norm);
}

/** The best place for the template near box `b` in frame `g`: a coarse search, then finer ones. */
function search(g: Pic, tpl: Template, b: Rect) {
  let best = { ...b, s: -2 };
  const reach = Math.max(4, 0.35 * Math.max(b.w, b.h));
  const step = Math.max(1, reach / 8);
  for (const scale of SCALES) {
    const w = b.w * scale;
    const h = b.h * scale;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    for (let dy = -reach; dy <= reach; dy += step)
      for (let dx = -reach; dx <= reach; dx += step) {
        const c = { x: cx + dx - w / 2, y: cy + dy - h / 2, w, h };
        const s = score(g, tpl, c);
        if (s > best.s) best = { ...c, s };
      }
  }
  // Refine around the best, halving the step down to half a pixel.
  for (let d = step / 2; d >= 0.5; d /= 2) {
    const around = best;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const c = { ...around, x: around.x + dx * d, y: around.y + dy * d };
        const s = score(g, tpl, c);
        if (s > best.s) best = { ...c, s };
      }
  }
  return best;
}

/**
 * Follow `box` (0–1, as drawn on frame `start`) through every frame, forwards and backwards.
 * Returns a box per frame (null where it was lost) and the first frame lost in each direction.
 */
export function trackBox(frames: Pic[], start: number, box: Box): { boxes: (Box | null)[]; lost: { before?: number; after?: number } } {
  const boxes: (Box | null)[] = frames.map(() => null);
  const lost: { before?: number; after?: number } = {};
  if (!frames[start]) return { boxes, lost };
  const { w: W, h: H } = frames[start];
  const px = (b: Box): Rect => ({ x: b.x * W, y: b.y * H, w: b.w * W, h: b.h * H });
  const norm = (b: Rect): Box => {
    const w = Math.min(1, Math.max(0.02, b.w / W));
    const h = Math.min(1, Math.max(0.02, b.h / H));
    return { x: Math.min(1 - w, Math.max(0, b.x / W)), y: Math.min(1 - h, Math.max(0, b.y / H)), w, h };
  };
  boxes[start] = box;
  const first = templateOf(frames[start], px(box));

  for (const dir of [1, -1] as const) {
    let at = px(box);
    let tpl = first;
    for (let f = start + dir; f >= 0 && f < frames.length; f += dir) {
      const found = search(frames[f], tpl, at);
      // Lost when it no longer matches how it looked lately, or no longer looks like what was boxed.
      if (found.s < LOST_BELOW || score(frames[f], first, found) < FIRST_BELOW) {
        lost[dir > 0 ? "after" : "before"] = f;
        break;
      }
      at = { x: found.x, y: found.y, w: found.w, h: found.h };
      boxes[f] = norm(at);
      // Let the look drift slowly with the thing (it turns, the light changes), anchored to the first.
      const now = templateOf(frames[f], at);
      if (now.tw === first.tw && now.th === first.th) {
        const mixed = new Float32Array(first.t.length);
        let ss = 0;
        for (let i = 0; i < mixed.length; i++) {
          mixed[i] = 0.6 * tpl.t[i] + 0.2 * now.t[i] + 0.2 * first.t[i];
          ss += mixed[i] * mixed[i];
        }
        tpl = { t: mixed, tw: first.tw, th: first.th, norm: Math.sqrt(ss) };
      }
    }
  }
  return { boxes, lost };
}

/** How far apart two boxes are: the larger of their corners' distances, in 0–1 of the frame. */
const gap = (a: Box, b: Box) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h));

/** Each tracked box averaged with its neighbours (`r` either side, within the tracked stretch): the jitter goes, the path stays. */
export function smoothTrack(boxes: (Box | null)[], r = 2): (Box | null)[] {
  return boxes.map((b, f) => {
    if (!b) return null;
    const near: Box[] = [];
    for (let k = f - r; k <= f + r; k++) if (boxes[k]) near.push(boxes[k]!);
    const avg = (key: keyof Box) => near.reduce((s, n) => s + n[key], 0) / near.length;
    return { x: avg("x"), y: avg("y"), w: avg("w"), h: avg("h") };
  });
}

/**
 * The fewest keyframes whose smoothstep (as the GPU eases between them) stays within `tol` of the
 * tracked boxes: start with the first and last tracked frames, add the worst frame until it fits.
 */
export function keysFromTrack(boxes: (Box | null)[], tol = 0.015, most = 16): BoxKey[] {
  const tracked = smoothTrack(boxes)
    .map((b, f) => (b ? { ...b, f } : null))
    .filter((k): k is BoxKey => !!k);
  if (tracked.length <= 2) return tracked.map(rounded);
  let keys: BoxKey[] = [tracked[0], tracked[tracked.length - 1]];
  while (keys.length < most) {
    let worst: BoxKey | null = null;
    let worstGap = tol;
    for (const k of tracked) {
      const d = gap(boxAt(keys, k.f)!, k);
      if (d > worstGap) [worst, worstGap] = [k, d];
    }
    if (!worst) break;
    keys = [...keys, worst].sort((a, b) => a.f - b.f);
  }
  return keys.map(rounded);
}

const round = (v: number) => Math.round(v * 10000) / 10000;
const rounded = (k: BoxKey): BoxKey => ({ f: k.f, x: round(k.x), y: round(k.y), w: round(k.w), h: round(k.h) });

// Geometry shared by Henshin's editors and the Wan graphs: box tracks (Replace) and motion
// paths (Motion paths). Coordinates are 0–1 of the frame; the browser draws exactly what the GPU gets.

import type { BoxKey, PathPoint, PathTiming } from "./specs";

/** The same interpolation NovaBoxTrackMask uses: smoothstep between keys, hold at the ends. */
export function boxAt(keys: BoxKey[], f: number): BoxKey | null {
  if (!keys.length) return null;
  const k = [...keys].sort((a, b) => a.f - b.f);
  if (f <= k[0].f) return { ...k[0], f };
  if (f >= k[k.length - 1].f) return { ...k[k.length - 1], f };
  const j = k.findIndex((x, i) => x.f <= f && f < k[i + 1].f);
  const a = k[j];
  const b = k[j + 1];
  const u = (f - a.f) / (b.f - a.f);
  const s = u * u * (3 - 2 * u);
  return { f, x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, w: a.w + (b.w - a.w) * s, h: a.h + (b.h - a.h) * s };
}

/** Set (or replace) the key at frame `f`, keeping keys in time order. */
export const putKey = (keys: BoxKey[], k: BoxKey): BoxKey[] => [...keys.filter((x) => x.f !== k.f), k].sort((a, b) => a.f - b.f);

/** Move a key to another frame; a key already there gives way. */
export function retimeKey(keys: BoxKey[], from: number, to: number): BoxKey[] {
  const k = keys.find((x) => x.f === from);
  if (!k || from === to) return keys;
  return putKey(
    keys.filter((x) => x.f !== from),
    { ...k, f: to },
  );
}

/** A box kept inside the frame and at least `min` across. */
export function clampBox(b: Omit<BoxKey, "f">, min = 0.02): Omit<BoxKey, "f"> {
  const w = Math.min(1, Math.max(min, b.w));
  const h = Math.min(1, Math.max(min, b.h));
  return { x: Math.min(1 - w, Math.max(0, b.x)), y: Math.min(1 - h, Math.max(0, b.y)), w, h };
}

// ---------- Motion paths ----------

export const DEFAULT_TIMING: PathTiming = { start: 0, end: 1, ease: "smooth" };
export const timingOf = (timing: PathTiming[] | undefined, i: number): PathTiming => timing?.[i] ?? DEFAULT_TIMING;

const EASES: Record<PathTiming["ease"], (u: number) => number> = {
  smooth: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  linear: (u) => u,
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
};

const dist = (a: PathPoint, b: PathPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/** Fewer points along a hand-drawn stroke (Ramer–Douglas–Peucker), so it can be edited by its handles. */
export function simplify(points: PathPoint[], tolerance = 0.008): PathPoint[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  let worst = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const len = dist(a, b);
    const d = len < 1e-9 ? dist(p, a) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (d > worst) [worst, at] = [d, i];
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** The smooth curve through a path's points (Catmull–Rom), as a dense polyline. */
export function curve(points: PathPoint[], steps = 10): PathPoint[] {
  if (points.length < 3) return points;
  const out: PathPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push({ x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Where a path's thing is at time u (0–1 of the clip): held before its start, eased along the curve, held after its end. */
export function pathAt(points: PathPoint[], u: number, timing: PathTiming = DEFAULT_TIMING): PathPoint {
  if (points.length === 1) return points[0];
  const line = curve(points);
  const span = Math.max(1e-6, timing.end - timing.start);
  const w = EASES[timing.ease ?? "smooth"](Math.min(1, Math.max(0, (u - timing.start) / span)));
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dist(line[i], line[i - 1]));
  const d = w * cum[cum.length - 1];
  let seg = 0;
  while (seg < line.length - 2 && cum[seg + 1] < d) seg++;
  const t = Math.min(1, Math.max(0, (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1)));
  return { x: line[seg].x + (line[seg + 1].x - line[seg].x) * t, y: line[seg].y + (line[seg + 1].y - line[seg].y) * t };
}

/** Parallel paths over a 3×3 grid that move the whole frame, as a camera would. */
export type FrameMove = "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "push_in" | "pull_out";

export const FRAME_MOVES: { id: FrameMove; label: string }[] = [
  { id: "pan_left", label: "Pan left" },
  { id: "pan_right", label: "Pan right" },
  { id: "tilt_up", label: "Tilt up" },
  { id: "tilt_down", label: "Tilt down" },
  { id: "push_in", label: "Push in" },
  { id: "pull_out", label: "Pull out" },
];

export function frameMove(move: FrameMove, amount = 0.15): PathPoint[][] {
  const grid = [0.2, 0.5, 0.8];
  return grid.flatMap((y) =>
    grid.map((x) => {
      // Panning left shows what's to the left, so the picture slides right.
      const shift: Record<FrameMove, PathPoint> = {
        pan_left: { x: x + amount, y },
        pan_right: { x: x - amount, y },
        tilt_up: { x, y: y + amount },
        tilt_down: { x, y: y - amount },
        push_in: { x: 0.5 + (x - 0.5) * (1 + 2 * amount), y: 0.5 + (y - 0.5) * (1 + 2 * amount) },
        pull_out: { x: 0.5 + (x - 0.5) / (1 + 2 * amount), y: 0.5 + (y - 0.5) / (1 + 2 * amount) },
      };
      const to = shift[move];
      // The centre of a push stays put: a single pinned point.
      return Math.abs(to.x - x) < 1e-6 && Math.abs(to.y - y) < 1e-6 ? [{ x, y }] : [{ x, y }, { x: Math.min(1, Math.max(0, to.x)), y: Math.min(1, Math.max(0, to.y)) }];
    }),
  );
}

// Framing shortcuts: put the opening camera mark where a classic shot of the stand-ins would be
// (a wide, a two-shot, a medium, a close-up, an over-the-shoulder), with the lens to match. The
// rest of the move comes along, so a push-in stays a push-in. Pure functions, no drawing.

import type { Actor, CameraKey, Vec3 } from "@/lib/cinema/camera";
import { facingOf, walks, type CustomRig } from "@/lib/cinema/custom";
import { fovFor } from "@/lib/cinema/moves";
import { HEIGHTS, turnToward } from "./planGeometry";

export type Framing = { kind: "wide" } | { kind: "two" } | { kind: "medium" | "close" | "ots"; on: number };

type P2 = [number, number];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const unit = (v: P2, fallback: P2 = [0, 1]): P2 => {
  const l = Math.hypot(v[0], v[1]);
  return l < 1e-6 ? fallback : [v[0] / l, v[1] / l];
};
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
/** Square to `v`, on the side of `toward` (a direction): which side of the line the camera keeps. */
const sideOf = (v: P2, toward: P2): P2 => {
  const n: P2 = [-v[1], v[0]];
  return dot(n, toward) < 0 ? [-n[0], -n[1]] : n;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const clampY = (y: number, kind: "cam" | "aim") => Math.min(HEIGHTS[kind][1], Math.max(HEIGHTS[kind][0], y));

/** The stand-in nearest to stand-in `i` (whom an over-the-shoulder looks past). */
function partner(actors: Actor[], i: number): number {
  let best = -1;
  let d = Infinity;
  actors.forEach((b, j) => {
    const dj = Math.hypot(b.from[0] - actors[i].from[0], b.from[1] - actors[i].from[1]);
    if (j !== i && dj < d) [best, d] = [j, dj];
  });
  return best;
}

/** Can this framing be made with these stand-ins? */
export function canFrame(actors: Actor[], f: Framing): boolean {
  if (f.kind === "wide") return actors.length > 0;
  if (f.kind === "two") return actors.length >= 2;
  return !!actors[f.on] && (f.kind !== "ots" || actors.length >= 2);
}

/**
 * The rig with mark A framing the shot `f` on a frame `aspect` wide, and every other mark moved by
 * as much (in place, aim and lens). For an over-the-shoulder, the two people turn to each other
 * unless they were already turned some way. Unchanged when the framing can't be made.
 */
export function frameMarkA(r: CustomRig, f: Framing, aspect: number): CustomRig {
  const actors = r.actors;
  if (!canFrame(actors, f) || !r.keys.length) return r;
  const k0 = r.keys[0];
  const cam: P2 = [k0.pos[0], k0.pos[2]];
  let actorsOut = actors;

  /** A camera `dist` back from `aim` along `dir`, at height `y`, with a `mm` lens. */
  const shot = (aim: Vec3, dir: P2, dist: number, y: number, mm: number): Pick<CameraKey, "pos" | "target" | "fov"> => ({
    pos: [r2(aim[0] + dir[0] * dist), r2(clampY(y, "cam")), r2(aim[2] + dir[1] * dist)],
    target: [r2(aim[0]), r2(clampY(aim[1], "aim")), r2(aim[2])],
    fov: fovFor(mm),
  });
  /** How far back a lens of `mm` must be to fit a frame `h` tall and `w` wide. */
  const fit = (mm: number, h: number, w: number) => {
    const tv = Math.tan((fovFor(mm) * Math.PI) / 360);
    return Math.max(h / 2 / tv, w / 2 / (tv * aspect));
  };

  let next: Pick<CameraKey, "pos" | "target" | "fov">;
  if (f.kind === "wide") {
    const pts = actors.map((a) => a.from);
    const c: P2 = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const dir = unit(sub(cam, c));
    const right: P2 = [-dir[1], dir[0]];
    const across = pts.map((p) => dot(sub(p, c), right));
    const toward = Math.max(0, ...pts.map((p) => dot(sub(p, c), dir)));
    const tall = Math.max(...actors.map((a) => a.height));
    const w = Math.max(...across) - Math.min(...across) + 1.4;
    next = shot([c[0], tall * 0.5, c[1]], dir, fit(24, tall * 1.3, w) + toward, 1.5, 24);
  } else if (f.kind === "two") {
    const [a, b] = actors;
    const mid: P2 = [(a.from[0] + b.from[0]) / 2, (a.from[1] + b.from[1]) / 2];
    const line = sub(b.from, a.from);
    const dir = sideOf(unit(line, [1, 0]), sub(cam, mid));
    const tall = (a.height + b.height) / 2;
    next = shot([mid[0], tall * 0.74, mid[1]], dir, fit(35, tall * 0.7, Math.hypot(line[0], line[1]) + 1.1), tall * 0.92, 35);
  } else if (f.kind === "ots") {
    const j = f.on;
    const k = partner(actors, j);
    const a = actors[j];
    const b = actors[k];
    const u = unit(sub(b.from, a.from));
    const side = sideOf(u, sub(cam, b.from));
    // A metre behind the near shoulder and well out to the side, so it takes a third of the frame at most.
    const pos: P2 = [b.from[0] + u[0] * 1.05 + side[0] * 0.6, b.from[1] + u[1] * 1.05 + side[1] * 0.6];
    const aim: Vec3 = [a.from[0], a.height * 0.86, a.from[1]];
    const dir = unit(sub(pos, [aim[0], aim[2]]));
    next = shot(aim, dir, Math.hypot(pos[0] - aim[0], pos[1] - aim[2]), b.height * 0.9, 50);
    // They talk to each other: the shoulder in the foreground turns its back to the lens.
    actorsOut = actors.map((x, i) => (i !== j && i !== k) || walks(x) || x.turn !== undefined ? x : { ...x, turn: turnToward(x, ...(i === j ? b.from : a.from)) });
  } else {
    const a = actors[f.on];
    const close = f.kind === "close";
    // Square on to where they face; a few degrees off toward the camera's side when someone else is in the scene.
    const th = (facingOf(a, k0.pos) * Math.PI) / 180;
    const face: P2 = [Math.sin(th), Math.cos(th)];
    const dir = actors.length > 1 ? unit([face[0] + sideOf(face, sub(cam, a.from))[0] * 0.45, face[1] + sideOf(face, sub(cam, a.from))[1] * 0.45]) : face;
    const s = a.height / 1.75;
    const mm = close ? 85 : 50;
    next = close
      ? shot([a.from[0], a.height * 0.9, a.from[1]], dir, fit(mm, 0.46 * s, 0.4 * s), a.height * 0.93, mm)
      : shot([a.from[0], a.height * 0.78, a.from[1]], dir, fit(mm, 0.66 * s, 0.6 * s), a.height * 0.92, mm);
  }

  const dp: Vec3 = [next.pos[0] - k0.pos[0], next.pos[1] - k0.pos[1], next.pos[2] - k0.pos[2]];
  const dt: Vec3 = [next.target[0] - k0.target[0], next.target[1] - k0.target[1], next.target[2] - k0.target[2]];
  const df = next.fov - k0.fov;
  const keys = r.keys.map((k, i) =>
    i === 0
      ? { ...k, ...next }
      : {
          ...k,
          pos: [r2(k.pos[0] + dp[0]), r2(clampY(k.pos[1] + dp[1], "cam")), r2(k.pos[2] + dp[2])] as Vec3,
          target: [r2(k.target[0] + dt[0]), r2(clampY(k.target[1] + dt[1], "aim")), r2(k.target[2] + dt[2])] as Vec3,
          fov: Math.min(120, Math.max(5, k.fov + df)),
        },
  );
  return { ...r, keys, actors: actorsOut };
}

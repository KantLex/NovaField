// The floor plan's geometry: the handles you drag, the view between metres and pixels, where set
// pieces go, and editing the rig's camera points and stand-ins. Pure functions, no drawing.

import { linearTimeFor, poseAt, type Actor, type CameraKey, type CameraPath, type Prop, type Vec3 } from "@/lib/cinema/camera";
import { DEFAULT_ACTOR, facingOf, walks, type CustomRig } from "@/lib/cinema/custom";
import { fovFor, LENSES } from "@/lib/cinema/moves";

/** What can be dragged: a camera mark or its aim, a stand-in's marks or the arrow it faces along, a set piece. */
export type Handle = { kind: "cam" | "aim" | "from" | "to" | "face" | "prop"; i: number };

export { SET_PIECES } from "@/lib/cinema/setPieces";
export const MAX_PROPS = 8;
export const PROP_RGB = "214,206,184";

/** Inside a set piece's footprint? */
export function inProp(p: Prop, x: number, z: number): boolean {
  const th = ((p.rot ?? 0) * Math.PI) / 180;
  const dx = x - p.at[0];
  const dz = z - p.at[1];
  // Undo the rotation (inverse of propCorners) to get local coordinates.
  const lx = dx * Math.cos(th) - dz * Math.sin(th);
  const lz = dx * Math.sin(th) + dz * Math.cos(th);
  return Math.abs(lx) <= p.size[0] / 2 && Math.abs(lz) <= p.size[2] / 2;
}

/**
 * Somewhere to drop a new set piece: the nearest spot (behind the subject first, then around it)
 * that clears the other pieces, the stand-ins and the camera marks.
 */
export function freeSpot(size: Vec3, props: Prop[], path: CameraPath): [number, number] {
  const r = Math.hypot(size[0], size[2]) / 2;
  const blockers: { x: number; z: number; r: number }[] = [
    ...props.map((p) => ({ x: p.at[0], z: p.at[1], r: Math.hypot(p.size[0], p.size[2]) / 2 })),
    ...(path.actors ?? [{ from: [0, 0] as [number, number] }]).map((a) => ({ x: a.from[0], z: a.from[1], r: 0.5 })),
    ...path.keys.map((k) => ({ x: k.pos[0], z: k.pos[2], r: 0.6 })),
  ];
  for (let ring = 1; ring <= 8; ring++) {
    const dist = ring * 1.2 + r * 0.6;
    for (let k = 0; k < 12; k++) {
      // Start straight behind the subject (away from the camera, -z) and sweep both ways.
      const a = -Math.PI / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      const x = Math.round(Math.cos(a) * dist * 10) / 10;
      const z = Math.round(Math.sin(a) * dist * 10) / 10;
      if (blockers.every((b) => Math.hypot(b.x - x, b.z - z) >= b.r + r + 0.2)) return [x, z];
    }
  }
  return [0, -3];
}

/** Distance, time and speed between each pair of camera marks, for labels on the plan. */
export function legs(path: CameraPath, marks: CameraKey[]) {
  const out: { mid: Vec3; dist: number; secs: number }[] = [];
  const frameOf = (t: number) => linearTimeFor(path.ease, t) * (path.frames - 1);
  for (let i = 0; i < marks.length - 1; i++) {
    const fa = frameOf(marks[i].t);
    const fb = frameOf(marks[i + 1].t);
    let dist = 0;
    let prev = poseAt(path, Math.round(fa)).pos;
    const steps = Math.max(2, Math.round(fb - fa));
    for (let k = 1; k <= steps; k++) {
      const q = poseAt(path, Math.round(fa + ((fb - fa) * k) / steps)).pos;
      dist += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
      prev = q;
    }
    out.push({ mid: poseAt(path, Math.round((fa + fb) / 2)).pos, dist, secs: (fb - fa) / path.fps });
  }
  return out;
}
export type View = { cx: number; cz: number; scale: number };

export const PILLARS: [number, number][] = [
  [-4, -6],
  [4, -6],
  [-7, 0],
  [7, 0],
  [-4, 6],
  [4, 6],
];
export const TUNGSTEN = "#E4FF1A";
export const keyLabel = (i: number, n: number) => (i === 0 ? "A" : i === n - 1 ? "B" : String(i));
export const lensOf = (fov: number) => LENSES.reduce((best, l) => (Math.abs(fovFor(l) - fov) < Math.abs(fovFor(best) - fov) ? l : best), LENSES[0]);

/** Presets have one figure at the origin; show it as stand-in 1 so it can be dragged. */
export const withCast = (p: CameraPath): CameraPath => (p.actors ? p : { ...p, actors: [{ ...DEFAULT_ACTOR }] });

/** Every draggable point, in draw and hit-test order: set pieces, aims, cameras, then people on top. `y` is its height (the 3D plan). */
export function handles(p: CameraPath): { h: Handle; x: number; y: number; z: number }[] {
  const out: { h: Handle; x: number; y: number; z: number }[] = [];
  (p.props ?? []).forEach((pr, i) => out.push({ h: { kind: "prop", i }, x: pr.at[0], y: pr.size[1] / 2, z: pr.at[1] }));
  p.keys.forEach((k, i) => out.push({ h: { kind: "aim", i }, x: k.target[0], y: k.target[1], z: k.target[2] }));
  p.keys.forEach((k, i) => out.push({ h: { kind: "cam", i }, x: k.pos[0], y: k.pos[1], z: k.pos[2] }));
  (p.actors ?? []).forEach((a, i) => {
    if (walks(a)) out.push({ h: { kind: "to", i }, x: a.to[0], y: 0, z: a.to[1] });
    else {
      const [x, z] = facePoint(a, p.keys[0].pos);
      out.push({ h: { kind: "face", i }, x, y: 0, z });
    }
    out.push({ h: { kind: "from", i }, x: a.from[0], y: 0, z: a.from[1] });
  });
  return out;
}

/** How far in front of a standing stand-in its facing arrow sits, in metres. */
export const FACE_REACH = 0.75;

/** The tip of a standing stand-in's facing arrow on the floor. */
export function facePoint(a: Actor, cam: Vec3): [number, number] {
  const th = (facingOf(a, cam) * Math.PI) / 180;
  return [a.from[0] + Math.sin(th) * FACE_REACH, a.from[1] + Math.cos(th) * FACE_REACH];
}

/** The turn that faces a stand-in toward floor point (x, z), to the nearest 5°. */
export function turnToward(a: Actor, x: number, z: number): number {
  const deg = (Math.atan2(x - a.from[0], z - a.from[1]) * 180) / Math.PI;
  const r = Math.round(deg / 5) * 5;
  return r === -180 ? 180 : r;
}

/** How far the line of action runs past the two people, each way, in metres. */
const LINE_REACH = 9;

/**
 * The line of action (the 180° line) through stand-ins 1 and 2 where they start, run out across the
 * set: a camera kept on one side of it keeps them on the same sides of the frame from shot to shot.
 * Null with fewer than two people, or two on the same spot.
 */
export function lineOfAction(p: CameraPath): [[number, number], [number, number]] | null {
  const [a, b] = p.actors ?? [];
  if (!a || !b) return null;
  const dx = b.from[0] - a.from[0];
  const dz = b.from[1] - a.from[1];
  const l = Math.hypot(dx, dz);
  if (l < 0.3) return null;
  const ux = dx / l;
  const uz = dz / l;
  return [
    [a.from[0] - ux * LINE_REACH, a.from[1] - uz * LINE_REACH],
    [b.from[0] + ux * LINE_REACH, b.from[1] + uz * LINE_REACH],
  ];
}

/** True when two turns (degrees) point the same way: 180 and -180 alike. */
export const sameTurn = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180) < 0.5;

/** How high a camera mark or its aim can go, as on the inspector's sliders. */
export const HEIGHTS = { cam: [0.1, 9], aim: [0, 4] } as const;

/** Where a view ray (origin, direction) meets the level plane at height `y`, as floor [x, z]. Null when it never does, or far off the set. */
export function rayToLevel(o: Vec3, d: Vec3, y: number): [number, number] | null {
  if (Math.abs(d[1]) < 1e-6) return null;
  const t = (y - o[1]) / d[1];
  if (t <= 0) return null;
  const x = o[0] + d[0] * t;
  const z = o[2] + d[2] * t;
  return Math.abs(x) > 40 || Math.abs(z) > 40 ? null : [x, z];
}

/** The height a view ray points at on the upright plane through `p` that faces the viewer: dragging a mark up and down. */
export function rayToHeight(o: Vec3, d: Vec3, p: Vec3): number | null {
  // The plane's normal is the view direction laid flat, so the mark keeps its place on the floor.
  const nx = d[0];
  const nz = d[2];
  const denom = d[0] * nx + d[2] * nz;
  if (denom < 1e-6) return null;
  const t = ((p[0] - o[0]) * nx + (p[2] - o[2]) * nz) / denom;
  return t <= 0 ? null : o[1] + d[1] * t;
}

/** A box scaled as one, so its longest side is `longest` metres: a 3D take's set piece keeps the model's proportions. */
export function scaleBox(size: Vec3, longest: number): Vec3 {
  const big = Math.max(size[0], size[1], size[2], 1e-6);
  return size.map((v) => Math.max(0.05, Math.round(((v / big) * longest) * 100) / 100)) as Vec3;
}

/** Metres on the floor (x, z) → pixels on a w×h plan. */
export const toScreen = (v: View, x: number, z: number, w: number, h: number): [number, number] => [w / 2 + (x - v.cx) * v.scale, h / 2 + (z - v.cz) * v.scale];

/** Pixels on a w×h plan → metres on the floor (x, z). */
export const toWorld = (v: View, sx: number, sy: number, w: number, h: number): [number, number] => [v.cx + (sx - w / 2) / v.scale, v.cz + (sy - h / 2) / v.scale];

/** Insert a camera point in the middle of the longest stretch of the path. */
export function addPoint(r: CustomRig): CustomRig {
  if (r.keys.length >= 6) return r;
  let j = 0;
  let longest = -1;
  for (let i = 0; i < r.keys.length - 1; i++) {
    const a = r.keys[i].pos;
    const b = r.keys[i + 1].pos;
    const d = Math.hypot(a[0] - b[0], a[2] - b[2]) + 0.001 * (r.keys[i + 1].t - r.keys[i].t);
    if (d > longest) {
      longest = d;
      j = i;
    }
  }
  const raw: CameraPath = { version: 1, frames: 1001, fps: 24, ease: "linear", keys: r.keys };
  const t = (r.keys[j].t + r.keys[j + 1].t) / 2;
  const p = poseAt(raw, Math.round(t * 1000));
  // Nudge sideways so the new point is visible and bends the path.
  const dx = r.keys[j + 1].pos[0] - r.keys[j].pos[0];
  const dz = r.keys[j + 1].pos[2] - r.keys[j].pos[2];
  const l = Math.hypot(dx, dz) || 1;
  const key: CameraKey = { t, pos: [p.pos[0] - (dz / l) * 0.8, p.pos[1], p.pos[2] + (dx / l) * 0.8], target: p.target, fov: p.fov, roll: p.roll };
  const keys = [...r.keys.slice(0, j + 1), key, ...r.keys.slice(j + 1)];
  return { ...r, keys };
}

export function removeActor(r: CustomRig, i: number): CustomRig {
  return {
    ...r,
    actors: r.actors.filter((_, j) => j !== i),
    follow: r.follow?.actor === i ? null : r.follow && r.follow.actor > i ? { ...r.follow, actor: r.follow.actor - 1 } : r.follow,
  };
}

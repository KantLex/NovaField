// The floor plan's geometry: the handles you drag, the view between metres and pixels, where set
// pieces go, and editing the rig's camera points and stand-ins. Pure functions, no drawing.

import { linearTimeFor, poseAt, type CameraKey, type CameraPath, type Prop, type Vec3 } from "@/lib/cinema/camera";
import { DEFAULT_ACTOR, type CustomRig } from "@/lib/cinema/custom";
import { fovFor, LENSES } from "@/lib/cinema/moves";

export type Handle = { kind: "cam" | "aim" | "from" | "to" | "prop"; i: number };

/** Set pieces to block a scene with: real-world sizes, [width, height, depth] in metres. */
export const SET_PIECES: { label: string; size: Vec3 }[] = [
  { label: "Table", size: [1.6, 0.75, 0.9] },
  { label: "Counter", size: [2.4, 1.05, 0.6] },
  { label: "Sofa", size: [2.1, 0.85, 0.9] },
  { label: "Bed", size: [1.6, 0.6, 2.1] },
  { label: "Car", size: [4.5, 1.45, 1.8] },
  { label: "Wall", size: [4, 2.6, 0.15] },
  { label: "Door frame", size: [1, 2.1, 0.15] },
  { label: "Crate", size: [0.8, 0.8, 0.8] },
];
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

/** Every draggable point, in draw and hit-test order: set pieces, aims, cameras, then people on top. */
export function handles(p: CameraPath): { h: Handle; x: number; z: number }[] {
  const out: { h: Handle; x: number; z: number }[] = [];
  (p.props ?? []).forEach((pr, i) => out.push({ h: { kind: "prop", i }, x: pr.at[0], z: pr.at[1] }));
  p.keys.forEach((k, i) => out.push({ h: { kind: "aim", i }, x: k.target[0], z: k.target[2] }));
  p.keys.forEach((k, i) => out.push({ h: { kind: "cam", i }, x: k.pos[0], z: k.pos[2] }));
  (p.actors ?? []).forEach((a, i) => {
    if (a.to[0] !== a.from[0] || a.to[1] !== a.from[1]) out.push({ h: { kind: "to", i }, x: a.to[0], z: a.to[1] });
    out.push({ h: { kind: "from", i }, x: a.from[0], z: a.from[1] });
  });
  return out;
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

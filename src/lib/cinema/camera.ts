// Virtual camera: the same math as the NovaGhostRig node (docs/contract.md §1).
// The app previews moves with it, and the GPU renders the carrier video with the Python twin.

export type Vec3 = [number, number, number];
export type Ease = "linear" | "inOutSine" | "inOutCubic" | "outExpo" | "inExpo";

export interface CameraKey {
  t: number;
  pos: Vec3;
  target: Vec3;
  fov: number;
  roll: number;
}

/** A stand-in person on the set (contract §1b). Floor positions are [x, z] in metres. */
export interface Actor {
  from: [number, number];
  to: [number, number];
  height: number;
  /** When the walk starts and ends, as fractions of the shot (default 0 and 1). */
  start?: number;
  end?: number;
}

/** A set piece (contract §1c): a box on the floor. `size` is [width, height, depth] in metres, `rot` degrees about Y. */
export interface Prop {
  at: [number, number];
  size: Vec3;
  rot?: number;
  /** For people, not the node: "Table", "Wall"… */
  label?: string;
}

export interface Follow {
  actor: number;
  height: number;
  amount: number;
}

export interface CameraPath {
  version: 1;
  frames: number;
  fps: number;
  ease: Ease;
  keys: CameraKey[];
  shake?: { amount: number; freq: number; seed: number };
  actors?: Actor[];
  follow?: Follow;
  props?: Prop[];
}

export interface CameraPose {
  pos: Vec3;
  target: Vec3;
  fov: number;
  roll: number;
}

export interface CameraBasis {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  fov: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-9 ? [0, 0, 0] : scale(a, 1 / l);
};
const rad = (d: number) => (d * Math.PI) / 180;

export function ease(kind: Ease, t: number): number {
  switch (kind) {
    case "linear":
      return t;
    case "inOutSine":
      return -(Math.cos(Math.PI * t) - 1) / 2;
    case "inOutCubic":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "outExpo":
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case "inExpo":
      return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
  }
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u;
  const u3 = u2 * u;
  return [0, 1, 2].map(
    (i) =>
      0.5 *
      (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3),
  ) as Vec3;
}

/** Rotate v about a unit axis by angle (radians), Rodrigues' formula. */
function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

function rightOf(forward: Vec3): Vec3 {
  const r = cross(forward, [0, 1, 0]);
  return len(r) < 1e-6 ? [1, 0, 0] : norm(r);
}

const tLinear = (path: CameraPath, frame: number) => (path.frames <= 1 ? 0 : frame / (path.frames - 1));

/** The linear shot time (0..1) at which the eased clock reaches `t`: where a mark at `t` falls on the timeline. */
export function linearTimeFor(kind: Ease, t: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (ease(kind, mid) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How far through its walk a stand-in is at linear time `t`: 0 before `start`, 1 after `end`. */
export function walkProgress(t: number, start = 0, end = 1): number {
  if (end <= start) return t >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** World positions of every stand-in at `frame`. They always walk with inOutSine, within their own start and end. */
export function actorPositions(path: CameraPath, frame: number): Vec3[] {
  const t = tLinear(path, frame);
  return (path.actors ?? []).map((a) => {
    const w = ease("inOutSine", walkProgress(t, a.start, a.end));
    return [a.from[0] + (a.to[0] - a.from[0]) * w, 0, a.from[1] + (a.to[1] - a.from[1]) * w];
  });
}

/** The 8 corners of a set piece, index = yi*4 + sxi*2 + szi (bottom first), as in the node pack. */
export function propCorners(p: Prop): Vec3[] {
  const [cx, cz] = p.at;
  const [w, h, d] = p.size;
  const th = ((p.rot ?? 0) * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const out: Vec3[] = [];
  for (const y of [0, h])
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const lx = (sx * w) / 2;
        const lz = (sz * d) / 2;
        out.push([cx + lx * c + lz * s, y, cz - lx * s + lz * c]);
      }
  return out;
}

export const BOX_EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [0, 2],
  [1, 3],
  [4, 5],
  [6, 7],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export function poseAt(path: CameraPath, frame: number): CameraPose {
  const { keys } = path;
  const tLin = tLinear(path, frame);
  const t = ease(path.ease, tLin);

  let pose: CameraPose;
  if (keys.length === 1 || t <= keys[0].t) {
    pose = { ...keys[0] };
  } else if (t >= keys[keys.length - 1].t) {
    pose = { ...keys[keys.length - 1] };
  } else {
    let j = 0;
    while (j < keys.length - 2 && !(keys[j].t <= t && t < keys[j + 1].t)) j++;
    const k1 = keys[j];
    const k2 = keys[j + 1];
    const k0 = keys[Math.max(0, j - 1)];
    const k3 = keys[Math.min(keys.length - 1, j + 2)];
    const u = (t - k1.t) / (k2.t - k1.t);
    pose = {
      pos: catmull(k0.pos, k1.pos, k2.pos, k3.pos, u),
      target: catmull(k0.target, k1.target, k2.target, k3.target, u),
      fov: k1.fov + (k2.fov - k1.fov) * u,
      roll: k1.roll + (k2.roll - k1.roll) * u,
    };
  }

  const fol = path.follow;
  const actor = fol ? actorPositions(path, frame)[fol.actor] : undefined;
  if (fol && actor) {
    const amount = Math.min(1, Math.max(0, fol.amount ?? 1));
    const aim: Vec3 = [actor[0], fol.height ?? 1.4, actor[2]];
    pose = { ...pose, target: add(pose.target, scale(sub(aim, pose.target), amount)) };
  }

  const sh = path.shake;
  if (sh && sh.amount > 0) {
    const s = frame / path.fps;
    const f = sh.freq;
    const ph = sh.seed * 0.7311;
    const TAU = Math.PI * 2;
    const yaw =
      sh.amount *
      1.6 *
      (0.6 * Math.sin(TAU * f * s + 1.3 + ph) + 0.3 * Math.sin(TAU * 2.3 * f * s + 0.7 + ph) + 0.1 * Math.sin(TAU * 5.1 * f * s + 2.1 + ph));
    const pitch =
      sh.amount *
      1.1 *
      (0.6 * Math.sin(TAU * 0.9 * f * s + 0.4 + ph) + 0.3 * Math.sin(TAU * 2.7 * f * s + 1.9 + ph) + 0.1 * Math.sin(TAU * 4.3 * f * s + 0.2 + ph));
    let v = sub(pose.target, pose.pos);
    v = rotate(v, [0, 1, 0], rad(yaw));
    v = rotate(v, rightOf(norm(v)), rad(pitch));
    pose = { ...pose, target: add(pose.pos, v) };
  }
  return pose;
}

export function basis(pose: CameraPose): CameraBasis {
  const f = norm(sub(pose.target, pose.pos));
  const r = rightOf(f);
  const u = cross(r, f);
  const th = rad(pose.roll);
  const c = Math.cos(th);
  const s = Math.sin(th);
  return {
    pos: pose.pos,
    forward: f,
    right: add(scale(r, c), scale(u, s)),
    up: sub(scale(u, c), scale(r, s)),
    fov: pose.fov,
  };
}

/** World point → pixel. Returns null behind the near plane. z is camera depth. */
export function project(b: CameraBasis, p: Vec3, width: number, height: number): [number, number, number] | null {
  const d = sub(p, b.pos);
  const zc = dot(d, b.forward);
  if (zc <= 0.05) return null;
  const focal = height / 2 / Math.tan(rad(b.fov) / 2);
  return [width / 2 + (focal * dot(d, b.right)) / zc, height / 2 - (focal * dot(d, b.up)) / zc, zc];
}

export const vec = { add, sub, scale, dot, cross, len, norm, rotate };

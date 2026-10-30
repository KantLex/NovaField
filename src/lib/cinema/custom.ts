// Custom camera rigs: a preset move forked into editable marks, plus stand-ins and follow.
// Also turns any path into plain words, for the prompt when the rig is drawn by hand.

import { actorPositions, basis, poseAt, type Actor, type CameraKey, type CameraPath, type Ease, type Follow, type Prop, type Vec3 } from "./camera";
import { buildPath, composePath, type MoveContext, type MoveLayer } from "./moves";

export interface CustomRig {
  keys: CameraKey[];
  ease: Ease;
  actors: Actor[];
  follow: Follow | null;
  /** Set pieces (boxes) on the floor. Missing on rigs saved before they existed. */
  props?: Prop[];
  /** What the move is called when it was saved or imported by name. */
  name?: string;
}

export type Timing = "auto" | Ease;

export const TIMINGS: { id: Timing; label: string; title: string }[] = [
  { id: "auto", label: "Auto", title: "Whatever suits the move" },
  { id: "inOutSine", label: "Smooth", title: "Gentle start and stop" },
  { id: "linear", label: "Steady", title: "Constant speed, like a dolly on rails" },
  { id: "inExpo", label: "Build", title: "Starts slow, ends fast" },
  { id: "outExpo", label: "Settle", title: "Starts fast, eases to a stop" },
];

export const DEFAULT_ACTOR: Actor = { from: [0, 0], to: [0, 0], height: 1.75 };
/** Stand-in colours in the app's previs (the GPU guide video uses its own, see docs/contract.md). */
export const ACTOR_COLORS = ["#E4FF1A", "#F4F4EC", "#7FC8F8"];

export interface PathInput extends MoveContext {
  move: string;
  /** Stacked moves; replaces `move` when there are any. */
  combo?: MoveLayer[] | null;
  rig?: CustomRig | null;
  timing?: Timing;
  shake?: number;
}

/** The camera path a shot will render, from a preset or a custom rig, with timing and handheld applied. */
export function shotPath(s: PathInput): CameraPath {
  const timing = s.timing && s.timing !== "auto" ? s.timing : undefined;
  if (s.rig) {
    const extra = s.shake ?? 0;
    return {
      version: 1,
      frames: s.frames,
      fps: s.fps,
      ease: timing ?? s.rig.ease,
      keys: s.rig.keys,
      actors: s.rig.actors,
      ...(s.rig.props?.length ? { props: s.rig.props } : {}),
      ...(s.rig.follow ? { follow: s.rig.follow } : {}),
      ...(extra > 0 ? { shake: { amount: extra, freq: 1.1, seed: 7 } } : {}),
    };
  }
  // Moves bake their own easing into dense keys; a chosen timing re-times each move instead.
  const base = s.combo?.length ? composePath(s.combo, s, timing) : buildPath(s.move, s, timing);
  const shake = Math.max(base.shake?.amount ?? 0, s.shake ?? 0);
  return { ...base, ...(shake > 0 ? { shake: { amount: shake, freq: base.shake?.freq ?? 1.1, seed: base.shake?.seed ?? 7 } } : { shake: undefined }) };
}

/** Turn a preset into editable marks: its own keys when there are few, otherwise 5 samples along it. */
export function forkRig(path: CameraPath): CustomRig {
  let keys: CameraKey[];
  if (path.keys.length === 1) {
    const k = path.keys[0];
    keys = [
      { ...k, t: 0 },
      { ...k, t: 1 },
    ];
  } else if (path.keys.length <= 5) {
    keys = path.keys.map((k) => ({ ...k }));
  } else {
    // Sample the raw key curve (no ease, no shake) so the shape survives.
    const raw: CameraPath = { ...path, ease: "linear", shake: undefined, follow: undefined, frames: 101 };
    keys = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ t, ...poseAt(raw, Math.round(t * 100)) }));
  }
  return { keys, ease: path.ease, actors: path.actors ?? [{ ...DEFAULT_ACTOR }], follow: path.follow ?? null, props: path.props ?? [] };
}

/** True when nothing moves: no point rendering a motion guide. */
export function isStill(path: CameraPath): boolean {
  if (path.shake && path.shake.amount > 0) return false;
  if (path.actors?.some((a) => a.from[0] !== a.to[0] || a.from[1] !== a.to[1])) return false;
  const a = poseAt(path, 0);
  const b = poseAt(path, path.frames - 1);
  const mid = poseAt(path, Math.floor(path.frames / 2));
  const d = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  return d(a.pos, b.pos) + d(a.pos, mid.pos) < 0.02 && d(a.target, b.target) + d(a.target, mid.target) < 0.02 && Math.abs(a.fov - b.fov) < 0.5;
}

const horiz = (v: Vec3) => Math.hypot(v[0], v[2]);

/** Plain-words description of a camera path and its blocking, for the prompt. */
export function describePath(path: CameraPath): string {
  const n = path.frames - 1;
  const a = poseAt(path, 0);
  const b = poseAt(path, n);
  const focusAt = (f: number, fallback: Vec3): Vec3 => (path.follow && actorPositions(path, f)[path.follow.actor]) || fallback;
  const fa = focusAt(0, a.target);
  const fb = focusAt(n, b.target);
  const dA = horiz([a.pos[0] - fa[0], 0, a.pos[2] - fa[2]]);
  const dB = horiz([b.pos[0] - fb[0], 0, b.pos[2] - fb[2]]);
  const parts: string[] = [];

  // Orbit: how far the camera swings around what it looks at.
  let swing = 0;
  for (let i = 1; i <= 8; i++) {
    const p0 = poseAt(path, Math.round(((i - 1) / 8) * n));
    const p1 = poseAt(path, Math.round((i / 8) * n));
    const a0 = Math.atan2(p0.pos[0] - p0.target[0], p0.pos[2] - p0.target[2]);
    const a1 = Math.atan2(p1.pos[0] - p1.target[0], p1.pos[2] - p1.target[2]);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    swing += d;
  }
  const deg = Math.round((swing * 180) / Math.PI);
  const travel = horiz([b.pos[0] - a.pos[0], 0, b.pos[2] - a.pos[2]]);

  if (Math.abs(deg) >= 25) parts.push(`the camera arcs ${Math.abs(deg) >= 300 ? "a full circle" : `${Math.abs(deg)} degrees`} around the subject`);
  else if (travel > 0.4) {
    const ab = basis(a);
    const move: Vec3 = [b.pos[0] - a.pos[0], 0, b.pos[2] - a.pos[2]];
    const side = move[0] * ab.right[0] + move[2] * ab.right[2];
    const fwd = move[0] * ab.forward[0] + move[2] * ab.forward[2];
    if (Math.abs(side) > Math.abs(fwd)) parts.push(`the camera tracks sideways to the ${side > 0 ? "right" : "left"}`);
    else parts.push(fwd > 0 ? "the camera dollies in toward the subject" : "the camera pulls back away from the subject");
  } else if (dB < dA * 0.8) parts.push("the camera pushes in");

  const rise = b.pos[1] - a.pos[1];
  if (Math.abs(rise) > 0.6) parts.push(rise > 0 ? "rising like a crane" : "descending like a crane");
  if (b.fov < a.fov - 4) parts.push("while zooming in");
  else if (b.fov > a.fov + 4) parts.push("while zooming out");
  if (Math.abs(b.roll - a.roll) > 6) parts.push("rolling the horizon");
  if (path.shake && path.shake.amount > 0.25) parts.push("handheld with natural shake");
  if (!parts.length) parts.push("the camera holds still");
  if (path.follow && path.actors?.[path.follow.actor]) parts.push("always keeping the subject framed as it moves");

  const blocking = describeBlocking(path);
  return `${capitalise(parts.join(", "))}.${blocking ? ` ${blocking}` : ""}`;
}

/** Which way each stand-in walks, as seen from the opening camera. */
export function describeBlocking(path: CameraPath): string {
  const actors = path.actors ?? [];
  if (!actors.length) return "";
  const cam = basis(poseAt(path, 0));
  const names = ["The main subject", "The second person", "The third person"];
  const lines: string[] = [];
  actors.forEach((a, i) => {
    const dx = a.to[0] - a.from[0];
    const dz = a.to[1] - a.from[1];
    if (Math.hypot(dx, dz) < 0.3) {
      if (actors.length > 1) lines.push(`${names[i]} stays in place${a.height < 1.4 ? " (a child)" : ""}.`);
      return;
    }
    const side = dx * cam.right[0] + dz * cam.right[2];
    const depth = dx * cam.forward[0] + dz * cam.forward[2];
    const dir =
      Math.abs(side) >= Math.abs(depth)
        ? `walks across the frame from ${side > 0 ? "left to right" : "right to left"}`
        : depth > 0
          ? "walks away from the camera"
          : "walks toward the camera";
    lines.push(`${names[i]} ${dir}${walkWhen(a.start ?? 0, a.end ?? 1)}.`);
  });
  return lines.join(" ");
}

/** "", " halfway through the shot", " in the second half of the shot"… */
function walkWhen(start: number, end: number): string {
  if (start <= 0.1 && end >= 0.9) return "";
  if (end - start < 0.15) return start < 0.33 ? " early in the shot" : start > 0.66 ? " late in the shot" : " halfway through the shot";
  if (start >= 0.4) return " in the second half of the shot";
  if (end <= 0.6) return " in the first half of the shot, then stops";
  return start > 0.1 ? " after a pause" : ", then stops";
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

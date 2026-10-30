// Camera moves as files: NovaField's camera-path JSON (docs/contract.md §1), so a move can be
// exported, shared, edited by hand or written by another tool (the Blender exporter in samples/),
// and imported back as an editable custom move.

import type { Actor, CameraKey, CameraPath, Ease, Follow, Prop, Vec3 } from "./camera";
import type { CustomRig } from "./custom";
import { say } from "@/lib/say";

const EASES: Ease[] = ["linear", "inOutSine", "inOutCubic", "outExpo", "inExpo"];
const MAX_KEYS = 240;

export interface RigFile {
  rig: CustomRig;
  name?: string;
  /** How long the move runs, when the file says (frames / fps). */
  seconds?: number;
  /** Handheld shake 0–1, when the file has some. */
  shake?: number;
}

/** A move as a file: the contract's camera_path, with a name and what wrote it. */
export function exportRig(path: CameraPath, name: string): string {
  const file = {
    format: "novafield-camera-path",
    name,
    version: 1,
    frames: path.frames,
    fps: path.fps,
    ease: path.ease,
    keys: path.keys.map((k) => ({ t: round(k.t, 4), pos: k.pos.map((v) => round(v, 4)), target: k.target.map((v) => round(v, 4)), fov: round(k.fov, 3), roll: round(k.roll, 3) })),
    // An empty list is kept: it means "no figures", where a missing list means the default one.
    ...(path.actors ? { actors: path.actors } : {}),
    ...(path.follow ? { follow: path.follow } : {}),
    ...(path.props?.length ? { props: path.props } : {}),
    ...(path.shake && path.shake.amount > 0 ? { shake: path.shake } : {}),
  };
  return JSON.stringify(file, null, 2);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

class Bad extends Error {}

const num = (v: unknown, what: string, opts: { min?: number; max?: number; fallback?: number } = {}): number => {
  if (v === undefined || v === null) {
    if (opts.fallback !== undefined) return opts.fallback;
    throw new Bad(`${what} is missing`);
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Bad(`${what} must be a number`);
  if (opts.min !== undefined && v < opts.min) throw new Bad(`${what} must be at least ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new Bad(`${what} must be at most ${opts.max}`);
  return v;
};

const vec = (v: unknown, n: 2 | 3, what: string): number[] => {
  if (!Array.isArray(v) || v.length !== n || v.some((x) => typeof x !== "number" || !Number.isFinite(x)))
    throw new Bad(`${what} needs ${n === 3 ? "three numbers [x, y, z]" : "two numbers [x, z]"}`);
  if (v.some((x) => Math.abs(x) > 1000)) throw new Bad(`${what} is more than 1 km from the subject; positions are in metres`);
  return v as number[];
};

/**
 * Read a camera move from a file's text. Accepts the contract's camera_path, an export from
 * NovaField, a bare rig ({ keys, ease, actors, follow, props }), or any of them under
 * "camera_path" or "rig". Returns what's wrong, in words, when it can't.
 */
export function parseRigFile(text: string): RigFile | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: say("That isn't valid JSON: {reason}", { reason: e instanceof Error ? e.message : String(e) }) };
  }
  try {
    return readRig(data);
  } catch (e) {
    if (e instanceof Bad) return { error: say("That camera path can't be used: {reason}.", { reason: e.message }) };
    throw e;
  }
}

function readRig(data: unknown): RigFile {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Bad("the file should hold one object with a list of keys");
  let o = data as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 60) : undefined;
  for (const wrap of ["camera_path", "rig"]) if (o[wrap] && typeof o[wrap] === "object") o = o[wrap] as Record<string, unknown>;

  if (!Array.isArray(o.keys) || o.keys.length === 0) throw new Bad('it needs "keys": a list of camera positions over the shot');
  if (o.keys.length > MAX_KEYS) throw new Bad(`it has ${o.keys.length} keys; ${MAX_KEYS} at most (sample every few frames)`);
  const n = o.keys.length;
  let keys: CameraKey[] = o.keys.map((raw, i) => {
    const what = `key ${i + 1}`;
    if (!raw || typeof raw !== "object") throw new Bad(`${what} isn't an object`);
    const k = raw as Record<string, unknown>;
    return {
      // Keys without times are spread evenly over the shot.
      t: num(k.t, `${what}: t`, { min: 0, max: 1, fallback: n === 1 ? 0 : i / (n - 1) }),
      pos: vec(k.pos, 3, `${what}: pos`) as Vec3,
      target: vec(k.target, 3, `${what}: target`) as Vec3,
      fov: num(k.fov, `${what}: fov`, { min: 1, max: 170, fallback: 40 }),
      roll: num(k.roll, `${what}: roll`, { min: -360, max: 360, fallback: 0 }),
    };
  });
  keys.forEach((k, i) => {
    const d = Math.hypot(k.target[0] - k.pos[0], k.target[1] - k.pos[1], k.target[2] - k.pos[2]);
    if (d < 1e-4) throw new Bad(`key ${i + 1}: target is where the camera is, so it looks nowhere`);
  });
  keys = keys.sort((a, b) => a.t - b.t);
  // One key is a locked-off shot; the editor works with a start and an end.
  if (keys.length === 1) keys = [{ ...keys[0], t: 0 }, { ...keys[0], t: 1 }];

  const ease = (o.ease ?? "linear") as Ease;
  if (!EASES.includes(ease)) throw new Bad(`"ease" must be one of ${EASES.join(", ")}`);

  const actors: Actor[] = [];
  if (o.actors !== undefined) {
    if (!Array.isArray(o.actors)) throw new Bad('"actors" must be a list');
    o.actors.slice(0, 3).forEach((raw, i) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      const what = `actor ${i + 1}`;
      const from = vec(a.from, 2, `${what}: from`) as [number, number];
      actors.push({
        from,
        to: a.to === undefined ? from : (vec(a.to, 2, `${what}: to`) as [number, number]),
        height: num(a.height, `${what}: height`, { min: 0.3, max: 3, fallback: 1.75 }),
        ...(a.start !== undefined ? { start: Math.min(1, Math.max(0, num(a.start, `${what}: start`))) } : {}),
        ...(a.end !== undefined ? { end: Math.min(1, Math.max(0, num(a.end, `${what}: end`))) } : {}),
      });
    });
  }

  let follow: Follow | null = null;
  if (o.follow) {
    const f = o.follow as Record<string, unknown>;
    const actor = num(f.actor, "follow: actor", { min: 0, fallback: 0 });
    if (actor >= actors.length) throw new Bad(`"follow" points at actor ${actor + 1}, but there ${actors.length === 1 ? "is 1 actor" : `are ${actors.length} actors`}`);
    follow = { actor: Math.round(actor), height: num(f.height, "follow: height", { min: 0, max: 5, fallback: 1.4 }), amount: num(f.amount, "follow: amount", { min: 0, max: 1, fallback: 1 }) };
  }

  const props: Prop[] = [];
  if (o.props !== undefined) {
    if (!Array.isArray(o.props)) throw new Bad('"props" must be a list');
    o.props.slice(0, 8).forEach((raw, i) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      const what = `prop ${i + 1}`;
      props.push({
        at: vec(p.at, 2, `${what}: at`) as [number, number],
        size: p.size === undefined ? [1, 1, 1] : (vec(p.size, 3, `${what}: size`).map((v) => Math.max(0.05, v)) as Vec3),
        ...(p.rot !== undefined ? { rot: num(p.rot, `${what}: rot`) } : {}),
        ...(typeof p.label === "string" ? { label: p.label.slice(0, 40) } : {}),
      });
    });
  }

  const frames = typeof o.frames === "number" && o.frames > 1 ? o.frames : undefined;
  const fps = typeof o.fps === "number" && o.fps > 0 ? o.fps : undefined;
  const shake = o.shake && typeof o.shake === "object" ? Number((o.shake as Record<string, unknown>).amount) : undefined;
  return {
    rig: { keys, ease, actors: o.actors !== undefined ? actors : [{ from: [0, 0], to: [0, 0], height: 1.75 }], follow, props },
    ...(name ? { name } : {}),
    ...(frames && fps ? { seconds: frames / fps } : {}),
    ...(shake !== undefined && Number.isFinite(shake) && shake > 0 ? { shake: Math.min(1, shake) } : {}),
  };
}

// Camera moves as camera-path generators, plus the framing vocabulary they share with the prompt.

import { ease as easeFn, vec, type CameraKey, type CameraPath, type Ease, type Vec3 } from "./camera";

export type ShotSize = "extreme_wide" | "wide" | "full" | "medium" | "close" | "extreme_close";
export type Angle = "eye" | "low" | "high" | "overhead" | "dutch";

export const SHOT_SIZES: { id: ShotSize; label: string; prompt: string; distance: number; aim: number }[] = [
  { id: "extreme_wide", label: "Extreme wide", prompt: "extreme wide establishing shot, the subject small in a vast environment", distance: 11, aim: 1.2 },
  { id: "wide", label: "Wide", prompt: "wide shot showing the subject and their surroundings", distance: 6.5, aim: 1.1 },
  { id: "full", label: "Full", prompt: "full shot, the subject framed head to toe", distance: 4.2, aim: 1.0 },
  { id: "medium", label: "Medium", prompt: "medium shot framed from the waist up", distance: 2.4, aim: 1.35 },
  { id: "close", label: "Close-up", prompt: "close-up on the face", distance: 1.25, aim: 1.58 },
  { id: "extreme_close", label: "Extreme close-up", prompt: "extreme close-up on the eyes and fine detail", distance: 0.7, aim: 1.62 },
];

export const ANGLES: { id: Angle; label: string; prompt: string; height: number; roll: number }[] = [
  { id: "eye", label: "Eye level", prompt: "eye-level camera", height: 0, roll: 0 },
  { id: "low", label: "Low angle", prompt: "low-angle camera looking up, heroic", height: -0.9, roll: 0 },
  { id: "high", label: "High angle", prompt: "high-angle camera looking down", height: 1.4, roll: 0 },
  { id: "overhead", label: "Overhead", prompt: "top-down overhead shot", height: 4.5, roll: 0 },
  { id: "dutch", label: "Dutch", prompt: "dutch angle, tilted horizon, unsettling", height: 0.1, roll: 14 },
];

export const LENSES = [14, 24, 35, 50, 85, 135] as const;
export type Lens = (typeof LENSES)[number];

export const lensPrompt: Record<Lens, string> = {
  14: "14mm ultra-wide lens, strong perspective distortion",
  24: "24mm wide lens, deep perspective",
  35: "35mm lens, natural perspective",
  50: "50mm lens, classic normal perspective",
  85: "85mm portrait lens, compressed background, shallow depth of field",
  135: "135mm telephoto lens, heavy compression, creamy bokeh",
};

/** Vertical FOV for a full-frame (24 mm tall) sensor. */
export const fovFor = (mm: number) => (2 * Math.atan(12 / mm) * 180) / Math.PI;

export interface Framing {
  size: ShotSize;
  angle: Angle;
  lens: Lens;
}

export interface MoveContext extends Framing {
  frames: number;
  fps: number;
  /** 0.3 = subtle, 1 = normal, 1.6 = aggressive. */
  intensity: number;
}

/*
  Moves are built from camera channels that change over time, so they stack: layering
  "push in" and "pan left" just adds their channels. Distances are metres, angles degrees.

  dolly     toward the subject along the floor (the aim point stays put)
  truck     sideways, camera and aim together (positive = to the camera's right)
  pedestal  straight up, camera and aim together
  crane     camera up, aim point fixed, so the camera looks down as it rises
  orbit     around the aim point (positive = arc to the camera's right)
  pan       turn the view (positive = right)        tilt  (positive = up)
  roll      tilt the horizon (positive = clockwise)
  zoom      focal-length multiplier (2 = twice as tight)
  shake     handheld amount, 0–1
*/
export type Channel = "dolly" | "truck" | "pedestal" | "crane" | "orbit" | "pan" | "tilt" | "roll" | "zoom" | "shake";

export interface Track {
  ch: Channel;
  from: number;
  to: number;
  /** Part of the shot this track plays in (0–1); before it holds `from`, after it holds `to`. */
  start?: number;
  end?: number;
  ease?: Ease;
}

export type MoveCategory = "dolly" | "pan" | "crane" | "orbit" | "lens" | "style";

export const CATEGORIES: { id: MoveCategory; label: string }[] = [
  { id: "dolly", label: "Dolly & track" },
  { id: "pan", label: "Pan & tilt" },
  { id: "crane", label: "Crane & drone" },
  { id: "orbit", label: "Orbit" },
  { id: "lens", label: "Lens" },
  { id: "style", label: "Style" },
];

interface Base {
  pos: Vec3;
  target: Vec3;
  fov: number;
  roll: number;
  distance: number;
  aim: number;
}

export function baseFor(f: Framing): Base {
  const size = SHOT_SIZES.find((s) => s.id === f.size)!;
  const angle = ANGLES.find((a) => a.id === f.angle)!;
  // A longer lens stands further back to hold the same framing.
  const distance = size.distance * (f.lens / 35);
  const aim = size.aim;
  const height = angle.id === "overhead" ? aim + Math.max(3, distance) : Math.max(0.15, aim + angle.height * Math.min(1, distance / 3));
  const horiz = angle.id === "overhead" ? 0.01 : distance;
  return { pos: [0, height, horiz], target: [0, aim, 0], fov: fovFor(f.lens), roll: angle.roll, distance, aim };
}

export interface MoveDef {
  id: string;
  label: string;
  hint: string;
  prompt: string;
  category: MoveCategory;
  /** Tracks for intensity 1, given the framing's base pose. */
  tracks: (b: Base) => Track[];
}

const tr = (ch: Channel, from: number, to: number, opts: Partial<Track> = {}): Track => ({ ch, from, to, ...opts });
const side = (b: Base) => 1.4 * Math.max(0.6, b.distance / 2.4);

export const MOVES: MoveDef[] = [
  // Dolly & track
  { id: "locked", label: "Locked off", hint: "Tripod, no movement", prompt: "static locked-off camera on a tripod", category: "dolly", tracks: () => [] },
  { id: "push_in", label: "Push in", hint: "Dolly toward the subject", prompt: "slow dolly push-in toward the subject", category: "dolly", tracks: (b) => [tr("dolly", 0, 0.42 * b.distance, { ease: "inOutCubic" })] },
  {
    id: "pull_out",
    label: "Pull out",
    hint: "Dolly away to reveal",
    prompt: "dolly pull-out revealing the surroundings",
    category: "dolly",
    tracks: (b) => [tr("dolly", 0, -0.9 * b.distance), tr("crane", 0, 0.3)],
  },
  {
    id: "truck_left",
    label: "Truck left",
    hint: "Slide sideways, parallel",
    prompt: "lateral tracking shot, camera trucking left alongside the subject",
    category: "dolly",
    tracks: (b) => [tr("truck", side(b) / 2, -side(b) / 2)],
  },
  {
    id: "truck_right",
    label: "Truck right",
    hint: "Slide sideways, parallel",
    prompt: "lateral tracking shot, camera trucking right alongside the subject",
    category: "dolly",
    tracks: (b) => [tr("truck", -side(b) / 2, side(b) / 2)],
  },
  {
    id: "drift",
    label: "Drift",
    hint: "Barely moving, alive",
    prompt: "slow, almost imperceptible floating camera drift",
    category: "dolly",
    tracks: (b) => [tr("dolly", 0, 0.12 * b.distance, { ease: "linear" }), tr("truck", -0.12, 0.12, { ease: "linear" }), tr("pan", 1.5, -1.5, { ease: "linear" })],
  },
  {
    id: "creep_in",
    label: "Creep in",
    hint: "Slow, tense approach",
    prompt: "very slow, tense creeping push-in on the subject",
    category: "dolly",
    tracks: (b) => [tr("dolly", 0, 0.18 * b.distance, { ease: "linear" })],
  },
  {
    id: "snap_push",
    label: "Snap push",
    hint: "Quick dolly in, then hold",
    prompt: "sudden fast dolly push-in that snaps closer to the subject, then holds",
    category: "dolly",
    tracks: (b) => [tr("dolly", 0, 0.45 * b.distance, { start: 0.38, end: 0.56, ease: "outExpo" })],
  },
  {
    id: "diagonal",
    label: "Diagonal glide",
    hint: "Slide sideways and in",
    prompt: "camera glides diagonally, tracking sideways while moving in toward the subject",
    category: "dolly",
    tracks: (b) => [tr("truck", -side(b) / 2, side(b) / 2), tr("dolly", 0, 0.3 * b.distance)],
  },

  // Pan & tilt
  { id: "pan_left", label: "Pan left", hint: "Turn on the spot", prompt: "smooth pan to the left", category: "pan", tracks: () => [tr("pan", 14, -26)] },
  { id: "pan_right", label: "Pan right", hint: "Turn on the spot", prompt: "smooth pan to the right", category: "pan", tracks: () => [tr("pan", -14, 26)] },
  { id: "tilt_up", label: "Tilt up", hint: "Reveal upward", prompt: "slow tilt up revealing the subject from the ground upward", category: "pan", tracks: () => [tr("tilt", -22, 14)] },
  { id: "tilt_down", label: "Tilt down", hint: "From sky to subject", prompt: "slow tilt down from the sky to the subject", category: "pan", tracks: () => [tr("tilt", 24, -4)] },
  {
    id: "whip_pan_left",
    label: "Whip pan left",
    hint: "Snap left with blur",
    prompt: "fast whip pan to the left with motion blur",
    category: "pan",
    tracks: () => [tr("pan", 0, -80, { start: 0.45, end: 0.62, ease: "inOutSine" }), tr("roll", 0, -4, { start: 0.45, end: 0.62 })],
  },
  {
    id: "whip_pan",
    label: "Whip pan right",
    hint: "Snap right with blur",
    prompt: "fast whip pan to the right with motion blur",
    category: "pan",
    tracks: () => [tr("pan", 0, 80, { start: 0.45, end: 0.62, ease: "inOutSine" }), tr("roll", 0, 4, { start: 0.45, end: 0.62 })],
  },
  { id: "dutch_roll", label: "Dutch roll", hint: "Horizon tips over", prompt: "camera slowly rolls into a tilted dutch angle", category: "pan", tracks: () => [tr("roll", 0, 18)] },
  {
    id: "panorama",
    label: "Panorama",
    hint: "Slow sweep across the scene",
    prompt: "slow panoramic pan sweeping across the whole scene from left to right",
    category: "pan",
    tracks: () => [tr("pan", -40, 40, { ease: "linear" })],
  },
  {
    id: "look_around",
    label: "Look around",
    hint: "Glance left, then right",
    prompt: "searching camera that glances left, then pans across to the right",
    category: "pan",
    tracks: () => [tr("pan", 0, -28, { start: 0, end: 0.45 }), tr("pan", 0, 56, { start: 0.5, end: 1 })],
  },

  // Crane & drone
  {
    id: "crane_up",
    label: "Crane up",
    hint: "Rise high, look down",
    prompt: "crane shot rising up and over the subject",
    category: "crane",
    tracks: (b) => [tr("crane", 0, 3.2, { ease: "inOutCubic" }), tr("dolly", 0, 0.15 * b.distance, { ease: "inOutCubic" })],
  },
  {
    id: "crane_down",
    label: "Crane down",
    hint: "Descend into the scene",
    prompt: "crane shot descending from above down to the subject",
    category: "crane",
    tracks: (b) => [tr("crane", 3.2, 0, { ease: "inOutCubic" }), tr("dolly", 0.15 * b.distance, 0, { ease: "inOutCubic" })],
  },
  { id: "pedestal_up", label: "Pedestal up", hint: "Rise, keep the angle", prompt: "camera pedestals straight up, keeping its angle", category: "crane", tracks: () => [tr("pedestal", -0.6, 0.6)] },
  { id: "pedestal_down", label: "Pedestal down", hint: "Sink, keep the angle", prompt: "camera pedestals straight down, keeping its angle", category: "crane", tracks: () => [tr("pedestal", 0.6, -0.6)] },
  {
    id: "drone_reveal",
    label: "Drone reveal",
    hint: "Pull back and soar",
    prompt: "aerial drone shot pulling back and rising high to reveal the whole location",
    category: "crane",
    tracks: (b) => [tr("dolly", 0, -2.4 * b.distance), tr("crane", 0, 5)],
  },
  {
    id: "fpv_dive",
    label: "FPV dive",
    hint: "Drone swoops down and past",
    prompt: "FPV drone shot diving fast toward the subject and banking past",
    category: "crane",
    tracks: (b) => [
      tr("dolly", -2.5 * b.distance, 0.45 * b.distance),
      tr("crane", 6, 0),
      tr("orbit", -25, 40),
      tr("roll", -8, 18),
      tr("zoom", 0.8, 0.9),
      tr("shake", 0.15, 0.15),
    ],
  },
  {
    id: "overhead_rise",
    label: "Overhead rise",
    hint: "Rise to a top-down view",
    prompt: "camera rises straight up and over the subject into a top-down bird's-eye view",
    category: "crane",
    tracks: (b) => [tr("crane", 0, 6, { ease: "inOutCubic" }), tr("dolly", 0, 0.85 * b.distance, { ease: "inOutCubic" })],
  },
  {
    id: "drone_approach",
    label: "Drone approach",
    hint: "Fly in from far and high",
    prompt: "aerial drone shot flying in from far away and high up, descending toward the subject",
    category: "crane",
    tracks: (b) => [tr("dolly", -2.5 * b.distance, 0), tr("crane", 4, 0.6)],
  },
  {
    id: "aerial_orbit",
    label: "Aerial orbit",
    hint: "Circle high above",
    prompt: "high aerial drone orbit circling slowly around the subject from above",
    category: "crane",
    tracks: () => [tr("crane", 3.5, 3.5), tr("orbit", 0, 120, { ease: "linear" })],
  },
  {
    id: "ground_glide",
    label: "Ground glide",
    hint: "Skim low along the floor",
    prompt: "camera glides just above the ground toward the subject, looking up",
    category: "crane",
    // Crane lowers the camera but keeps the aim, so it looks up at the subject.
    tracks: (b) => [tr("crane", -(b.pos[1] - 0.3), -(b.pos[1] - 0.3)), tr("dolly", 0, 0.35 * b.distance, { ease: "linear" })],
  },

  // Orbit
  { id: "orbit_left", label: "Arc left", hint: "Circle around the subject", prompt: "camera arcs left around the subject in a smooth orbit", category: "orbit", tracks: () => [tr("orbit", 0, -70)] },
  { id: "orbit_right", label: "Arc right", hint: "Circle around the subject", prompt: "camera arcs right around the subject in a smooth orbit", category: "orbit", tracks: () => [tr("orbit", 0, 70)] },
  { id: "orbit_180", label: "Half orbit", hint: "Swing round to the back", prompt: "camera swings 180 degrees around the subject to see them from behind", category: "orbit", tracks: () => [tr("orbit", 0, 180)] },
  {
    id: "bullet_time",
    label: "Bullet time",
    hint: "Fast 360° around a frozen moment",
    prompt: "bullet-time shot, the camera sweeps 360 degrees around the subject while time nearly freezes",
    category: "orbit",
    tracks: () => [tr("orbit", 0, 360)],
  },
  { id: "spiral_up", label: "Spiral up", hint: "Orbit while rising", prompt: "camera spirals upward around the subject", category: "orbit", tracks: () => [tr("orbit", 0, 140), tr("crane", 0, 2.6)] },
  { id: "spiral_down", label: "Spiral down", hint: "Orbit while descending", prompt: "camera spirals down around the subject", category: "orbit", tracks: () => [tr("orbit", 0, -140), tr("crane", 2.6, 0)] },
  {
    id: "arc_in",
    label: "Arc in",
    hint: "Curve around and in",
    prompt: "camera arcs around the subject while pushing in closer",
    category: "orbit",
    tracks: (b) => [tr("orbit", 0, 55), tr("dolly", 0, 0.4 * b.distance)],
  },
  {
    id: "arc_out",
    label: "Arc out",
    hint: "Curve around and away",
    prompt: "camera arcs around the subject while pulling back",
    category: "orbit",
    tracks: (b) => [tr("orbit", 0, -55), tr("dolly", 0, -0.6 * b.distance)],
  },
  {
    id: "full_orbit",
    label: "Slow 360",
    hint: "One steady full circle",
    prompt: "slow, steady 360-degree orbit all the way around the subject",
    category: "orbit",
    tracks: () => [tr("orbit", 0, 360, { ease: "linear" })],
  },

  // Lens
  { id: "zoom_in", label: "Zoom in", hint: "Lens tightens, camera still", prompt: "slow optical zoom in", category: "lens", tracks: () => [tr("zoom", 1, 1.7)] },
  { id: "zoom_out", label: "Zoom out", hint: "Lens widens, camera still", prompt: "slow optical zoom out", category: "lens", tracks: () => [tr("zoom", 1.7, 1)] },
  {
    id: "crash_zoom",
    label: "Crash zoom",
    hint: "Sudden punch in",
    prompt: "sudden crash zoom punching in on the subject",
    category: "lens",
    tracks: () => [tr("zoom", 1, 2.4, { start: 0.4, end: 0.52, ease: "outExpo" })],
  },
  {
    id: "dolly_zoom",
    label: "Dolly zoom",
    hint: "Vertigo: move in, zoom out",
    prompt: "dolly zoom vertigo effect, the background stretches while the subject stays the same size",
    category: "lens",
    // Moving in by s·d while widening by (1 − s) keeps the subject the same size.
    tracks: (b) => [tr("dolly", 0, 0.55 * b.distance, { ease: "inOutSine" }), tr("zoom", 1, 0.45, { ease: "inOutSine" })],
  },
  {
    id: "dolly_zoom_out",
    label: "Reverse vertigo",
    hint: "Move out, zoom in",
    prompt: "reverse dolly zoom, the background compresses toward the subject",
    category: "lens",
    tracks: (b) => [tr("dolly", 0.55 * b.distance, 0, { ease: "inOutSine" }), tr("zoom", 0.45, 1, { ease: "inOutSine" })],
  },
  {
    id: "crash_zoom_out",
    label: "Crash zoom out",
    hint: "Sudden snap out",
    prompt: "sudden crash zoom snapping out from the subject to the wider scene",
    category: "lens",
    tracks: () => [tr("zoom", 2.4, 1, { start: 0.4, end: 0.52, ease: "outExpo" })],
  },
  {
    id: "rack_focus",
    label: "Rack focus",
    hint: "Focus pulls to the subject",
    prompt: "rack focus, the focus pulls from the foreground onto the subject",
    category: "lens",
    // Focus breathing: the image tightens a touch as the focus moves.
    tracks: () => [tr("zoom", 1, 1.06, { start: 0.3, end: 0.7 })],
  },

  // Style
  {
    id: "handheld",
    label: "Handheld",
    hint: "Documentary, breathing frame",
    prompt: "handheld camera with natural documentary shake",
    category: "style",
    tracks: (b) => [tr("shake", 0.55, 0.55), tr("dolly", 0, 0.07 * b.distance, { ease: "linear" }), tr("truck", 0, 0.15, { ease: "linear" })],
  },
  {
    id: "hero_rise",
    label: "Hero rise",
    hint: "Low, push in, look up",
    prompt: "low-angle hero shot, camera rising and pushing in while looking up at the subject",
    category: "style",
    tracks: (b) => [tr("pedestal", -(b.pos[1] - 0.35), -(b.pos[1] - 0.75), { ease: "inOutCubic" }), tr("dolly", -0.3 * b.distance, 0.3 * b.distance, { ease: "inOutCubic" }), tr("tilt", 14, 8)],
  },
  {
    id: "steadicam",
    label: "Steadicam",
    hint: "Smooth, gliding float",
    prompt: "smooth steadicam shot gliding gently with the subject",
    category: "style",
    tracks: (b) => [tr("dolly", 0, 0.25 * b.distance), tr("truck", -0.2, 0.2), tr("pan", 2, -2), tr("shake", 0.12, 0.12)],
  },
  {
    id: "barrel_roll",
    label: "Barrel roll",
    hint: "Rolls a full turn",
    prompt: "camera does a full barrel roll, the horizon spinning 360 degrees",
    category: "style",
    tracks: (b) => [tr("roll", 0, 360, { ease: "inOutCubic" }), tr("dolly", 0, 0.25 * b.distance)],
  },
  {
    id: "earthquake",
    label: "Earthquake",
    hint: "Violent shaking",
    prompt: "violent camera shake, as if the ground is quaking",
    category: "style",
    tracks: () => [tr("shake", 1, 1)],
  },
];

/** One move in a combination. */
export interface MoveLayer {
  id: string;
  intensity: number;
  /** Which part of the shot it plays in: all of it, the first half, or the second half. */
  when: "whole" | "start" | "end";
}

const WINDOWS: Record<MoveLayer["when"], [number, number]> = { whole: [0, 1], start: [0, 0.5], end: [0.5, 1] };

/** All tracks of a stack of moves, scaled by intensity and fitted into each layer's time window. */
export function layerTracks(layers: MoveLayer[], b: Base, timing?: Ease): Track[] {
  const out: Track[] = [];
  for (const layer of layers) {
    const move = MOVES.find((m) => m.id === layer.id);
    if (!move) continue;
    const [ls, le] = WINDOWS[layer.when] ?? WINDOWS.whole;
    for (const t of move.tracks(b)) {
      const k = layer.intensity;
      // Zoom scales as a power, everything else linearly.
      const scale = (v: number) => (t.ch === "zoom" ? Math.pow(v, k) : t.ch === "shake" ? Math.min(1, v * k) : v * k);
      const s = t.start ?? 0;
      const e = t.end ?? 1;
      // A chosen timing re-times whole-move tracks; snaps (whip, crash zoom) keep their own.
      const ease = timing && t.start === undefined && t.end === undefined ? timing : t.ease;
      out.push({ ...t, ease, from: scale(t.from), to: scale(t.to), start: ls + s * (le - ls), end: ls + e * (le - ls) });
    }
  }
  return out;
}

function channelsAt(tracks: Track[], u: number) {
  const v: Record<Channel, number> = { dolly: 0, truck: 0, pedestal: 0, crane: 0, orbit: 0, pan: 0, tilt: 0, roll: 0, zoom: 1, shake: 0 };
  for (const t of tracks) {
    const s = t.start ?? 0;
    const e = t.end ?? 1;
    const w = e > s ? Math.min(1, Math.max(0, (u - s) / (e - s))) : u >= e ? 1 : 0;
    const x = t.from + (t.to - t.from) * easeFn(t.ease ?? "inOutSine", w);
    if (t.ch === "zoom") v.zoom *= x;
    else if (t.ch === "shake") v.shake = Math.max(v.shake, x);
    else v[t.ch] += x;
  }
  return v;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** The camera at time u for a base framing and a set of channel values. */
function poseFromChannels(b: Base, c: ReturnType<typeof channelsAt>): Omit<CameraKey, "t"> {
  const up: Vec3 = [0, 1, 0];
  let target: Vec3 = [...b.target];
  let off = vec.sub(b.pos, b.target);
  if (c.orbit) off = vec.rotate(off, up, rad(c.orbit));
  let pos = vec.add(target, off);

  // Floor-plane frame looking at the aim point.
  let fwd = vec.norm([target[0] - pos[0], 0, target[2] - pos[2]]);
  if (vec.len(fwd) < 1e-6) fwd = [0, 0, -1];
  const right = vec.norm(vec.cross(fwd, up));
  const flat = Math.hypot(target[0] - pos[0], target[2] - pos[2]);
  // Never dolly through the aim point (the view would flip around).
  const dolly = Math.min(c.dolly, Math.max(0, flat - 0.25));
  pos = vec.add(pos, vec.scale(fwd, dolly));
  pos = vec.add(pos, vec.scale(right, c.truck));
  target = vec.add(target, vec.scale(right, c.truck));
  pos = [pos[0], pos[1] + c.pedestal + c.crane, pos[2]];
  target = [target[0], target[1] + c.pedestal, target[2]];

  // Turn the view: pan about the vertical, then tilt about the camera's right.
  let dir = vec.sub(target, pos);
  if (c.pan) dir = vec.rotate(dir, up, rad(-c.pan));
  if (c.tilt) {
    const r = vec.norm(vec.cross(vec.norm(dir), up));
    if (vec.len(r) > 1e-6) dir = vec.rotate(dir, r, rad(c.tilt));
  }
  const fov = (2 * Math.atan(Math.tan(rad(b.fov) / 2) / Math.max(0.05, c.zoom)) * 180) / Math.PI;
  return { pos, target: vec.add(pos, dir), fov: Math.min(120, fov), roll: b.roll + c.roll };
}

const SAMPLES = 33;

/** A stack of moves as a camera path (dense keys, so it plays exactly as composed). */
export function composePath(layers: MoveLayer[], c: MoveContext, timing?: Ease): CameraPath {
  const b = baseFor(c);
  const tracks = layerTracks(layers, b, timing);
  const keys: CameraKey[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const u = i / (SAMPLES - 1);
    keys.push({ t: u, ...poseFromChannels(b, channelsAt(tracks, u)) });
  }
  // Nothing moves: a single key keeps the path (and the ghost-rig check) simple.
  const still = keys.every((k) => vec.len(vec.sub(k.pos, keys[0].pos)) < 1e-6 && vec.len(vec.sub(k.target, keys[0].target)) < 1e-6 && Math.abs(k.fov - keys[0].fov) < 1e-6 && Math.abs(k.roll - keys[0].roll) < 1e-6);
  const shake = Math.max(0, ...tracks.filter((t) => t.ch === "shake").map((t) => Math.max(t.from, t.to)));
  return {
    version: 1,
    frames: c.frames,
    fps: c.fps,
    ease: "linear",
    keys: still ? [keys[0]] : keys,
    ...(shake > 0 ? { shake: { amount: shake, freq: 1.1, seed: 7 } } : {}),
  };
}

export function buildPath(moveId: string, c: MoveContext, timing?: Ease): CameraPath {
  return composePath([{ id: moveId, intensity: c.intensity, when: "whole" }], c, timing);
}

/** How a stack of moves reads in the prompt: "A while B; then C". */
export function describeLayers(layers: MoveLayer[]): string {
  const text = (l: MoveLayer) => {
    const m = MOVES.find((x) => x.id === l.id);
    if (!m) return "";
    return `${m.prompt}${l.intensity < 0.6 ? ", subtle" : l.intensity > 1.25 ? ", fast and dramatic" : ""}`;
  };
  const by = (w: MoveLayer["when"]) => layers.filter((l) => l.when === w).map(text).filter(Boolean);
  const start = by("start");
  const whole = by("whole");
  const end = by("end");
  const parts: string[] = [];
  if (whole.length) parts.push(whole.join(", while at the same time "));
  if (start.length) parts.push(`${parts.length ? "opening with " : "first, "}${start.join(" and ")}`);
  if (end.length) parts.push(`then ${end.join(" and ")}`);
  return parts.join("; ");
}

/** "Push in + Pan left". `t` translates each name for display. */
export const layerLabel = (layers: MoveLayer[], t: (s: string) => string = (s) => s) => layers.map((l) => t(MOVES.find((m) => m.id === l.id)?.label ?? l.id)).join(" + ");

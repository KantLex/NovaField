// What a camera operator reads off the rig at any moment of a path: lens, height, distance, speed.

import { actorPositions, poseAt, type CameraPath, type Vec3 } from "./camera";

export interface CameraReadout {
  /** Full-frame equivalent focal length. */
  mm: number;
  /** Lens height above the floor, metres. */
  height: number;
  /** Floor distance to the subject (the followed stand-in, else the first, else the origin). */
  distance: number;
  /** Camera speed through space, metres per second. */
  speed: number;
}

const subjectAt = (path: CameraPath, frame: number): Vec3 => {
  const actors = actorPositions(path, frame);
  if (path.follow && actors[path.follow.actor]) return actors[path.follow.actor];
  return actors[0] ?? [0, 0, 0];
};

export function readoutAt(path: CameraPath, frame: number): CameraReadout {
  const f = Math.max(0, Math.min(path.frames - 1, frame));
  const a = poseAt(path, Math.floor(f));
  const b = poseAt(path, Math.min(path.frames - 1, Math.floor(f) + 1));
  const s = subjectAt(path, f);
  const step = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
  return {
    mm: 12 / Math.tan((a.fov * Math.PI) / 360),
    height: a.pos[1],
    distance: Math.hypot(a.pos[0] - s[0], a.pos[2] - s[2]),
    speed: step * path.fps,
  };
}

/** Camera speed (m/s) sampled evenly across the shot, for the timeline's speed curve. */
export function speedCurve(path: CameraPath, samples = 64): number[] {
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const f = Math.round((i / (samples - 1)) * (path.frames - 2));
    const a = poseAt(path, f).pos;
    const b = poseAt(path, f + 1).pos;
    // Turning on the spot (pans, whips) matters too: count the aim point's travel as well.
    const ta = poseAt(path, f).target;
    const tb = poseAt(path, f + 1).target;
    const move = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const turn = Math.hypot(tb[0] - ta[0], tb[1] - ta[1], tb[2] - ta[2]) * 0.5;
    out.push(Math.max(move, turn) * path.fps);
  }
  return out;
}

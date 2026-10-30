import { describe, expect, it } from "vitest";
import type { CameraPath } from "./camera";
import { readoutAt, speedCurve } from "./metrics";

const key = (t: number, z: number, fov = 39.6) => ({ t, pos: [0, 1.6, z] as [number, number, number], target: [0, 1.2, 0] as [number, number, number], fov, roll: 0 });
// A linear push-in from 6 m to 2 m over 2 seconds.
const push: CameraPath = { version: 1, frames: 49, fps: 24, ease: "linear", keys: [key(0, 6), key(1, 2)] };

describe("camera readout", () => {
  it("reads lens, height, distance and speed", () => {
    const r = readoutAt(push, 0);
    expect(r.mm).toBeCloseTo(33, 0); // 39.6° vertical ≈ 33 mm full-frame
    expect(r.height).toBeCloseTo(1.6, 6);
    expect(r.distance).toBeCloseTo(6, 6);
    // Keys ease in and out, so the camera starts slow and peaks mid-shot (4 m in 2 s averages 2 m/s).
    expect(r.speed).toBeLessThan(2);
    expect(readoutAt(push, 24).speed).toBeGreaterThan(2);
    expect(readoutAt(push, 48).distance).toBeCloseTo(2, 6);
  });

  it("measures distance to the followed stand-in", () => {
    const p: CameraPath = { ...push, actors: [{ from: [3, 0], to: [3, 0], height: 1.75 }], follow: { actor: 0, height: 1.2, amount: 0 } };
    expect(readoutAt(p, 0).distance).toBeCloseTo(Math.hypot(3, 6), 6);
  });

  it("peaks mid-move and stays at zero for a locked-off shot", () => {
    const s = speedCurve(push);
    const peak = s.indexOf(Math.max(...s));
    expect(peak / (s.length - 1)).toBeCloseTo(0.5, 1);
    const still: CameraPath = { ...push, keys: [key(0, 4)] };
    expect(Math.max(...speedCurve(still))).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { basis, type Vec3 } from "@/lib/cinema/camera";
import type { CustomRig } from "@/lib/cinema/custom";
import { canFrame, frameMarkA } from "./framing";

const rig = (actors: CustomRig["actors"]): CustomRig => ({
  keys: [
    { t: 0, pos: [0, 1.6, 6], target: [0, 1.2, 0], fov: 40, roll: 0 },
    { t: 1, pos: [0, 1.6, 4], target: [0, 1.2, 0], fov: 40, roll: 0 },
  ],
  ease: "inOutSine",
  actors,
  follow: null,
});
const man = (x: number, z: number, extra = {}) => ({ from: [x, z] as [number, number], to: [x, z] as [number, number], height: 1.75, ...extra });

/** Where a point lands in the picture: -1..1 across and up, for a camera at `pos` looking at `target`. */
function onScreen(pos: Vec3, target: Vec3, fov: number, aspect: number, p: Vec3) {
  const b = basis({ pos, target, fov, roll: 0 });
  const v: Vec3 = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
  const z = v[0] * b.forward[0] + v[1] * b.forward[1] + v[2] * b.forward[2];
  const t = Math.tan((fov * Math.PI) / 360);
  return {
    x: (v[0] * b.right[0] + v[1] * b.right[1] + v[2] * b.right[2]) / z / (t * aspect),
    y: (v[0] * b.up[0] + v[1] * b.up[1] + v[2] * b.up[2]) / z / t,
    z,
  };
}

describe("framing shortcuts", () => {
  it("frames everyone head to toe in a wide, and carries the rest of the move along", () => {
    const r = frameMarkA(rig([man(-2, 0), man(2, 0.5)]), { kind: "wide" }, 16 / 9);
    const [a, b] = r.keys;
    for (const p of [[-2, 0, 0], [-2, 1.75, 0], [2, 0, 0.5], [2, 1.75, 0.5]] as Vec3[]) {
      const s = onScreen(a.pos, a.target, a.fov, 16 / 9, p);
      expect(s.z).toBeGreaterThan(0);
      expect(Math.abs(s.x)).toBeLessThan(1);
      expect(Math.abs(s.y)).toBeLessThan(1);
    }
    // Mark B keeps its place relative to A: still a push-in of 2 m.
    expect(Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2])).toBeCloseTo(2, 1);
  });

  it("keeps the camera on its side of the line for a two-shot", () => {
    const r = frameMarkA(rig([man(-1, 0), man(1, 0)]), { kind: "two" }, 16 / 9);
    expect(r.keys[0].pos[2]).toBeGreaterThan(1);
    expect(Math.abs(r.keys[0].pos[0])).toBeLessThan(0.01);
  });

  it("looks past one stand-in's shoulder at the other, and turns them to each other", () => {
    const r = frameMarkA(rig([man(-1, 0), man(1, 0)]), { kind: "ots", on: 0 }, 16 / 9);
    const a = r.keys[0];
    // Behind stand-in 2 (x > 1), on the camera's side of the line, aimed at stand-in 1's head.
    expect(a.pos[0]).toBeGreaterThan(1.5);
    expect(a.pos[2]).toBeGreaterThan(0);
    expect(a.target).toEqual([-1, 1.51, 0]);
    expect(r.actors[0].turn).toBe(90);
    expect(r.actors[1].turn).toBe(-90);
    // Someone already turned keeps their turn.
    expect(frameMarkA(rig([man(-1, 0, { turn: 0 }), man(1, 0)]), { kind: "ots", on: 0 }, 1).actors[0].turn).toBe(0);
  });

  it("gets closer for a close-up than a medium shot, with a longer lens", () => {
    const base = rig([man(0, 0)]);
    const med = frameMarkA(base, { kind: "medium", on: 0 }, 16 / 9).keys[0];
    const cu = frameMarkA(base, { kind: "close", on: 0 }, 16 / 9).keys[0];
    expect(cu.fov).toBeLessThan(med.fov);
    expect(med.pos[2]).toBeGreaterThan(0);
    // The face sits in the picture.
    const s = onScreen(cu.pos, cu.target, cu.fov, 16 / 9, [0, 1.6, 0]);
    expect(Math.abs(s.y)).toBeLessThan(1);
  });

  it("knows which framings need two people", () => {
    const one = [man(0, 0)];
    expect(canFrame(one, { kind: "two" })).toBe(false);
    expect(canFrame(one, { kind: "ots", on: 0 })).toBe(false);
    expect(canFrame(one, { kind: "close", on: 0 })).toBe(true);
    expect(frameMarkA(rig(one), { kind: "two" }, 1)).toEqual(rig(one));
  });
});

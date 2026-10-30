import { describe, expect, it } from "vitest";
import type { CameraKey } from "@/lib/cinema/camera";
import type { CustomRig } from "@/lib/cinema/custom";
import { addPoint, handles, keyLabel, removeActor, toScreen, toWorld } from "./planGeometry";

const key = (t: number, x: number, z: number): CameraKey => ({ t, pos: [x, 1.5, z], target: [0, 1, 0], fov: 40, roll: 0 });
const rig = (keys: CameraKey[], extra: Partial<CustomRig> = {}): CustomRig => ({ keys, ease: "linear", actors: [], follow: null, ...extra });

describe("the Studio plan", () => {
  it("adds a camera point in the middle of the longest stretch, bent off the line", () => {
    const r = addPoint(rig([key(0, 0, 0), key(0.5, 1, 0), key(1, 9, 0)]));
    expect(r.keys).toHaveLength(4);
    const added = r.keys[2];
    expect(added.t).toBeCloseTo(0.75);
    expect(added.pos[0]).toBeGreaterThan(1);
    expect(added.pos[0]).toBeLessThan(9);
    expect(Math.abs(added.pos[2])).toBeCloseTo(0.8); // nudged sideways so it's visible
    expect(r.keys.map((k) => k.t)).toEqual([...r.keys.map((k) => k.t)].sort((a, b) => a - b));
  });

  it("stops at six camera points", () => {
    const six = rig([0, 0.2, 0.4, 0.6, 0.8, 1].map((t, i) => key(t, i, 0)));
    expect(addPoint(six)).toBe(six);
  });

  it("keeps the follow pointing at the same person when one is removed", () => {
    const actors = [0, 1, 2].map((i) => ({ from: [i, 0] as [number, number], to: [i, 0] as [number, number], height: 1.7 }));
    const follow = (actor: number) => ({ actor, height: 1.5, amount: 1 });
    expect(removeActor(rig([], { actors, follow: follow(2) }), 0).follow?.actor).toBe(1);
    expect(removeActor(rig([], { actors, follow: follow(1) }), 1).follow).toBeNull();
    expect(removeActor(rig([], { actors, follow: follow(0) }), 2).follow?.actor).toBe(0);
    expect(removeActor(rig([], { actors, follow: null }), 1).actors.map((a) => a.from[0])).toEqual([0, 2]);
  });

  it("maps floor metres to pixels and back", () => {
    const view = { cx: 1.5, cz: -2, scale: 37 };
    const [sx, sy] = toScreen(view, 4.25, 3.5, 800, 500);
    const [x, z] = toWorld(view, sx, sy, 800, 500);
    expect(x).toBeCloseTo(4.25);
    expect(z).toBeCloseTo(3.5);
    expect(toScreen(view, view.cx, view.cz, 800, 500)).toEqual([400, 250]);
  });

  it("offers a walk's end handle only when the person moves", () => {
    const still = { from: [1, 1] as [number, number], to: [1, 1] as [number, number], height: 1.7 };
    const walking = { from: [0, 0] as [number, number], to: [2, 3] as [number, number], height: 1.7 };
    const kinds = handles({ version: 1, frames: 1, fps: 24, ease: "linear", keys: [key(0, 0, 5)], actors: [still, walking] }).map((h) => `${h.h.kind}${h.h.i}`);
    expect(kinds).toEqual(["aim0", "cam0", "from0", "to1", "from1"]);
  });

  it("labels the marks A, 1, 2…, B", () => {
    expect([0, 1, 2, 3].map((i) => keyLabel(i, 4))).toEqual(["A", "1", "2", "B"]);
  });
});

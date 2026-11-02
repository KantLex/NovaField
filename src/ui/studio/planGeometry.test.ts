import { describe, expect, it } from "vitest";
import type { CameraKey } from "@/lib/cinema/camera";
import type { CustomRig } from "@/lib/cinema/custom";
import { addPoint, facePoint, FACE_REACH, handles, keyLabel, rayToHeight, rayToLevel, removeActor, sameTurn, scaleBox, toScreen, toWorld, turnToward } from "./planGeometry";

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

  it("offers a walk's end handle when the person moves, and a facing arrow when they don't", () => {
    const still = { from: [1, 1] as [number, number], to: [1, 1] as [number, number], height: 1.7 };
    const walking = { from: [0, 0] as [number, number], to: [2, 3] as [number, number], height: 1.7 };
    const kinds = handles({ version: 1, frames: 1, fps: 24, ease: "linear", keys: [key(0, 0, 5)], actors: [still, walking] }).map((h) => `${h.h.kind}${h.h.i}`);
    expect(kinds).toEqual(["aim0", "cam0", "face0", "from0", "to1", "from1"]);
  });

  it("labels the marks A, 1, 2…, B", () => {
    expect([0, 1, 2, 3].map((i) => keyLabel(i, 4))).toEqual(["A", "1", "2", "B"]);
  });

  it("gives every handle its height, for the 3D plan", () => {
    const p = { version: 1 as const, frames: 2, fps: 24, ease: "linear" as const, keys: [key(0, 2, 5)], actors: [{ from: [1, 1] as [number, number], to: [1, 1] as [number, number], height: 1.75 }], props: [{ at: [0, -2] as [number, number], size: [1, 0.8, 1] as [number, number, number] }] };
    const y = Object.fromEntries(handles(p).map(({ h, y }) => [h.kind, y]));
    expect(y).toEqual({ prop: 0.4, aim: 1, cam: 1.5, face: 0, from: 0 });
  });

  it("finds where a view ray meets a level, and how high it points on an upright plane", () => {
    // Looking down at 45° from 4 m up: the floor is met 4 m ahead.
    expect(rayToLevel([0, 4, 0], [0, -Math.SQRT1_2, -Math.SQRT1_2], 0)).toEqual([0, expect.closeTo(-4)]);
    expect(rayToLevel([0, 4, 0], [0, -Math.SQRT1_2, -Math.SQRT1_2], 1.5)![1]).toBeCloseTo(-2.5);
    expect(rayToLevel([0, 4, 0], [0, 1, 0], 0)).toBeNull(); // looking away from it
    expect(rayToLevel([0, 4, 0], [1, 0, 0], 0)).toBeNull(); // level with it
    expect(rayToLevel([0, 1, 0], [0, -0.001, 1], 0)).toBeNull(); // off the set
    // A mark 5 m ahead: a ray rising at 45° from 1 m up points 6 m high there.
    expect(rayToHeight([0, 1, 0], [0, Math.SQRT1_2, -Math.SQRT1_2], [0, 2, -5])).toBeCloseTo(6);
    expect(rayToHeight([0, 1, 0], [0, 1, 0], [0, 2, -5])).toBeNull(); // straight up: no plane to meet
  });

  it("scales a 3D take's box as one, keeping its proportions", () => {
    expect(scaleBox([2, 1, 0.5], 1.5)).toEqual([1.5, 0.75, 0.38]);
    expect(scaleBox([1.5, 0.75, 0.38], 3)).toEqual([3, 1.5, 0.76]);
    expect(scaleBox([10, 0.001, 1], 1)).toEqual([1, 0.05, 0.1]); // never thinner than the node allows
  });

  it("points a standing person's arrow at the camera until they're turned, and turns them toward a dragged spot", () => {
    const a = { from: [1, 0] as [number, number], to: [1, 0] as [number, number], height: 1.75 };
    // The camera is straight ahead (+z) of the person: the arrow points at it.
    const [x, z] = facePoint(a, [1, 1.5, 5]);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(FACE_REACH);
    expect(facePoint({ ...a, turn: 90 }, [1, 1.5, 5])[0]).toBeCloseTo(1 + FACE_REACH);
    expect(turnToward(a, 1, -3)).toBe(180); // behind: their back to that camera
    expect(turnToward(a, 0, 0.01)).toBe(-90);
    expect(turnToward(a, 2, 1.02)).toBe(45); // to the nearest 5°
  });
});

describe("turns", () => {
  it("treats 180 and -180 as the same way", () => {
    expect(sameTurn(180, -180)).toBe(true);
    expect(sameTurn(-90, 270)).toBe(true);
    expect(sameTurn(0, 5)).toBe(false);
  });
});

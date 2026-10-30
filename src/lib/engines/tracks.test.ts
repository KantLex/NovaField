import { describe, expect, it } from "vitest";
import { boxAt, clampBox, curve, frameMove, pathAt, putKey, retimeKey, simplify } from "./tracks";
import { resamplePath } from "./wan";

const key = (f: number, x = 0.1) => ({ f, x, y: 0.1, w: 0.2, h: 0.2 });

describe("box tracks", () => {
  it("holds before the first key and after the last, and eases between", () => {
    const keys = [key(10, 0.1), key(30, 0.5)];
    expect(boxAt(keys, 0)!.x).toBe(0.1);
    expect(boxAt(keys, 50)!.x).toBe(0.5);
    expect(boxAt(keys, 20)!.x).toBeCloseTo(0.3);
  });

  it("replaces a key on the same frame, and retimes keys in order", () => {
    expect(putKey([key(0), key(10)], key(10, 0.4)).map((k) => k.x)).toEqual([0.1, 0.4]);
    expect(retimeKey([key(0), key(10, 0.4), key(20, 0.6)], 10, 25).map((k) => [k.f, k.x])).toEqual([
      [0, 0.1],
      [20, 0.6],
      [25, 0.4],
    ]);
    // Landing on another key replaces it.
    expect(retimeKey([key(0), key(10, 0.4)], 10, 0)).toEqual([key(0, 0.4)]);
  });

  it("keeps a box inside the frame", () => {
    expect(clampBox({ x: 0.9, y: -0.2, w: 0.3, h: 0.001 })).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.02 });
  });
});

describe("motion paths", () => {
  it("simplifies a hand-drawn stroke to a few handles", () => {
    const wobbly = Array.from({ length: 50 }, (_, i) => ({ x: i / 49, y: 0.5 + (i % 2 ? 0.002 : -0.002) }));
    expect(simplify(wobbly)).toHaveLength(2);
    const corner = [...Array.from({ length: 20 }, (_, i) => ({ x: i / 19, y: 0 })), ...Array.from({ length: 20 }, (_, i) => ({ x: 1, y: (i + 1) / 20 }))];
    expect(simplify(corner)).toHaveLength(3);
  });

  it("draws a smooth curve through the handles", () => {
    const c = curve([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }]);
    expect(c[0]).toEqual({ x: 0, y: 0 });
    expect(c.at(-1)).toEqual({ x: 1, y: 0 });
    expect(c.some((p) => Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y - 0.5) < 1e-9)).toBe(true);
  });

  it("waits for its start, moves inside its span, and holds at the end", () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const t = { start: 0.5, end: 0.75, ease: "linear" as const };
    expect(pathAt(line, 0.25, t).x).toBe(0);
    expect(pathAt(line, 0.625, t).x).toBeCloseTo(0.5);
    expect(pathAt(line, 0.9, t).x).toBe(1);
  });

  it("resamples to one point per frame, honouring the timing", () => {
    const pts = resamplePath([{ x: 0, y: 0 }, { x: 1, y: 0 }], 81, 832, 480, { start: 0.5, end: 1, ease: "smooth" });
    expect(pts).toHaveLength(81);
    expect(pts[40]).toEqual({ x: 0, y: 0 });
    expect(pts[80]).toEqual({ x: 832, y: 0 });
  });

  it("moves the whole frame for a camera preset", () => {
    const left = frameMove("pan_left");
    expect(left).toHaveLength(9);
    expect(left.every((p) => p.length === 2 && p[1].x > p[0].x)).toBe(true);
    const push = frameMove("push_in");
    expect(push.filter((p) => p.length === 1)).toHaveLength(1); // the centre stays put
  });
});

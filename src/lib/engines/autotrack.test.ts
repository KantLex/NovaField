import { describe, expect, it } from "vitest";
import { keysFromTrack, smoothTrack, trackBox, type Pic } from "./autotrack";
import { boxAt } from "./tracks";

// Deterministic noise, so the frames are the same every run.
const noise = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const W = 200;
const H = 120;
/** A wide textured backdrop, panned by `pan` px, so a moving camera can be faked. */
const backdrop = (() => {
  const r = noise(1);
  return Array.from({ length: (W + 200) * H }, () => [0.25 + 0.25 * r(), 0.35 + 0.25 * r(), 0.2 + 0.2 * r()]);
})();
/** The object: a 24×18 block in its own colours (blue-ish, like a jacket). */
const object = (() => {
  const r = noise(99);
  return Array.from({ length: 24 * 18 }, () => [0.15 + 0.2 * r(), 0.25 + 0.2 * r(), 0.55 + 0.35 * r()]);
})();

function scene(at: { x: number; y: number } | null, pan = 0): Pic {
  const data = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = backdrop[y * (W + 200) + x + 100 + Math.round(pan)];
      data.set(c, (y * W + x) * 3);
    }
  if (at)
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 24; x++) {
        const px = Math.round(at.x) + x;
        const py = Math.round(at.y) + y;
        if (px >= 0 && py >= 0 && px < W && py < H) data.set(object[y * 24 + x], (py * W + px) * 3);
      }
  return { w: W, h: H, data };
}

const boxed = (at: { x: number; y: number }) => ({ x: at.x / W, y: at.y / H, w: 24 / W, h: 18 / H });

describe("following a boxed object", () => {
  it("tracks a block across the frame, both ways from the frame it was boxed on", () => {
    const path = (f: number) => ({ x: 20 + 2 * f, y: 30 + f });
    const frames = Array.from({ length: 40 }, (_, f) => scene(path(f)));
    const { boxes, lost } = trackBox(frames, 15, boxed(path(15)));
    expect(lost).toEqual({});
    for (const f of [0, 10, 25, 39]) {
      expect(Math.abs(boxes[f]!.x * W - path(f).x)).toBeLessThan(1.5);
      expect(Math.abs(boxes[f]!.y * H - path(f).y)).toBeLessThan(1.5);
    }
  });

  it("stays on the object while the camera pans the other way", () => {
    // The backdrop slides 1.5 px a frame left as the object walks 2 px a frame right.
    const path = (f: number) => ({ x: 30 + 2 * f, y: 50 });
    const frames = Array.from({ length: 40 }, (_, f) => scene(path(f), 1.5 * f));
    const { boxes } = trackBox(frames, 0, boxed(path(0)));
    for (const f of [10, 20, 39]) expect(Math.abs(boxes[f]!.x * W - path(f).x)).toBeLessThan(2);
  });

  it("says where it lost the object", () => {
    const frames = Array.from({ length: 20 }, (_, f) => scene(f < 12 ? { x: 60 + f, y: 40 } : null));
    const { boxes, lost } = trackBox(frames, 0, boxed({ x: 60, y: 40 }));
    expect(lost.after).toBe(12);
    expect(boxes[11]).not.toBeNull();
    expect(boxes[12]).toBeNull();
  });

  it("keeps few keyframes for a steady move, and the GPU's easing retraces it", () => {
    // A straight move at constant speed: ease-in-out between two keys is off in the middle, so it needs a few.
    const boxes = Array.from({ length: 41 }, (_, f) => ({ x: 0.1 + 0.01 * f, y: 0.2, w: 0.1, h: 0.1 }));
    const keys = keysFromTrack(boxes);
    expect(keys[0].f).toBe(0);
    expect(keys.at(-1)!.f).toBe(40);
    expect(keys.length).toBeLessThan(12);
    const smooth = smoothTrack(boxes);
    for (let f = 0; f <= 40; f++) expect(Math.abs(boxAt(keys, f)!.x - smooth[f]!.x)).toBeLessThanOrEqual(0.0151);
    // Something that stays put needs just its two ends.
    expect(keysFromTrack(Array.from({ length: 30 }, () => ({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 })))).toHaveLength(2);
  });

  it("smooths away jitter without moving a steady path", () => {
    const jittery = Array.from({ length: 21 }, (_, f) => ({ x: 0.3 + (f % 2 ? 0.01 : -0.01), y: 0.3, w: 0.1, h: 0.1 }));
    const s = smoothTrack(jittery);
    expect(Math.abs(s[10]!.x - 0.3)).toBeLessThan(0.003);
  });
});

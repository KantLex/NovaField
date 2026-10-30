import { describe, expect, it } from "vitest";
import type { Asset } from "@/lib/engines/specs";
import { boxKeys, pathsFrom, pathsSpec, recastSpec, replaceSpec, restyleSpec } from "./henshin";

const clip: Asset = { name: "clip.mp4", kind: "video", url: "/c.mp4", frames: 81, fps: 16, width: 832, height: 480 };
const pic: Asset = { name: "lead.png", kind: "image", url: "/l.png", width: 1080, height: 1920 };

describe("Henshin for agents", () => {
  it("recasts with the page's defaults, and caps the extras", () => {
    const s = recastSpec({ source: clip, character: pic, seed: 4 });
    expect(s).toMatchObject({ kind: "recast", extras: [], notes: "", audio: "original", quality: "draft", seed: 4 });
    expect(() => recastSpec({ source: clip, character: pic, extras: [pic, pic, pic, pic] })).toThrow(/at most 3/);
  });

  it("restyles from words or a picture, grading on the GPU only with a film look", () => {
    expect(() => restyleSpec({ source: clip })).toThrow(/style/);
    expect(restyleSpec({ source: clip, style: "claymation" }).filmOnGpu).toBe(false);
    const s = restyleSpec({ source: clip, styleRef: pic, look: "noir" });
    expect(s.film.look).toBe("noir");
    expect(s.filmOnGpu).toBe(true);
    expect(() => restyleSpec({ source: clip, style: "x", look: "sepia" })).toThrow(/unknown film look/);
  });

  it("turns boxes at seconds into keyframes on the 16 fps clip", () => {
    const keys = boxKeys(
      [
        { x: 0.1, y: 0.2, w: 0.3, h: 0.3, at: 2 },
        { x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
        { x: 0.6, y: 0.5, w: 0.2, h: 0.2, at: 0.01 },
        { x: 0.9, y: 0.1, w: 0.3, h: 0.3, at: 99 },
      ],
      81,
    );
    expect(keys.map((k) => k.f)).toEqual([0, 32, 80]);
    expect(keys[0].x).toBe(0.6); // the later box on frame 0 wins
    expect(keys[2].x).toBeCloseTo(0.7); // pulled back inside the frame
    expect(() => boxKeys([], 81)).toThrow();
    expect(() => boxKeys([{ x: 0, y: 0, w: 1.5, h: 0.2 }], 81)).toThrow(/fractions/);
    expect(() => boxKeys([{ x: 0, y: 0, w: 0.01, h: 0.2 }], 81)).toThrow(/too small/);
  });

  it("replaces with a prompt or a picture", () => {
    expect(() => replaceSpec({ source: clip, boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] })).toThrow(/becomes/);
    const s = replaceSpec({ source: clip, boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }], replacement: pic, shape: "ellipse" });
    expect(s).toMatchObject({ kind: "replace", shape: "ellipse", prompt: "the replacement object" });
  });

  it("draws paths with their timing, pins, and a frame move", () => {
    const { paths, timing } = pathsFrom([{ points: [[0.2, 0.5], [0.8, 0.5]], start: 0.25, ease: "linear" }, { points: [[0.5, 0.9]] }], { move: "push_in" });
    expect(paths).toHaveLength(2 + 9);
    expect(paths[1]).toEqual([{ x: 0.5, y: 0.9 }]);
    expect(timing[0]).toEqual({ start: 0.25, end: 1, ease: "linear" });
    expect(() => pathsFrom([{ points: [[1.2, 0]] }])).toThrow(/fractions/);
    expect(() => pathsFrom([{ points: [[0, 0]], start: 0.9, end: 0.92 }])).toThrow(/end after start/);
    expect(() => pathsFrom([])).toThrow(/at least one/);
    expect(() => pathsFrom(Array.from({ length: 20 }, () => ({ points: [[0.1, 0.1]] as [number, number][] })), { move: "pan_left" })).toThrow(/At most 24/);
  });

  it("animates in the still's own shape", () => {
    expect(pathsSpec({ image: pic, paths: [{ points: [[0.5, 0.5]] }] }).aspect).toBe("9:16");
  });
});

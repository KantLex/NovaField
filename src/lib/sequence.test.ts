import { describe, expect, it } from "vitest";
import { at, clipFor, layout, normalize, sanitize, split, timecode, trim, type Clip } from "./sequence";

const src = { seconds: 5, fps: 24 };
const clip = (take: string, a: number, b: number, join: Clip["join"] = "cut"): Clip => ({ id: take, take, in: a, out: b, join });

describe("the edit", () => {
  it("reads sequences saved as plain take ids, dropping a continued take's repeated frames", () => {
    const clips = normalize(["a", "b"], (t) => (t === "b" ? { seconds: 5, fps: 24, trimHead: 12 } : src));
    expect(clips.map((c) => [c.take, c.in, c.out])).toEqual([
      ["a", 0, 5],
      ["b", 0.5, 5],
    ]);
  });

  it("lays clips end to end, and overlaps them by the dissolve", () => {
    const { placed, total } = layout([clip("a", 0, 4), clip("b", 1, 3), clip("c", 0, 2, "dissolve")]);
    expect(placed.map((p) => [p.start, p.fadeIn])).toEqual([
      [0, 0],
      [4, 0],
      [5.5, 0.5],
    ]);
    expect(total).toBe(7.5);
    expect(at(placed, 5.7).map((p) => p.clip.take)).toEqual(["b", "c"]);
  });

  it("keeps a dissolve within half of each clip", () => {
    const { placed } = layout([clip("a", 0, 0.4), clip("b", 0, 3, "dissolve")]);
    expect(placed[1].fadeIn).toBeCloseTo(0.2);
  });

  it("splits the clip under the playhead into two", () => {
    const r = split([clip("a", 0, 4), clip("b", 1, 3)], 5)!;
    expect(r.clips.map((c) => [c.take, c.in, c.out])).toEqual([
      ["a", 0, 4],
      ["b", 1, 2],
      ["b", 2, 3],
    ]);
    expect(r.clips[1].id).not.toBe(r.clips[2].id);
    expect(split([clip("a", 0, 4)], 0.05)).toBeNull();
  });

  it("trims on whole frames, inside the take", () => {
    expect(trim(clip("a", 0, 5), "in", 1.01, src).in).toBeCloseTo(1);
    expect(trim(clip("a", 0, 5), "out", 9, src).out).toBe(5);
    expect(trim(clip("a", 2, 5), "out", 1, src).out).toBeCloseTo(2.2);
  });

  it("keeps clips sent by agents cuttable", () => {
    expect(sanitize(clip("a", 6, 2), src)).toMatchObject({ in: 4.8, out: 5 });
    expect(sanitize(clip("a", 30, 40), src)).toMatchObject({ in: 4.8, out: 5 });
    expect(sanitize(clip("a", -1, 3), src)).toMatchObject({ in: 0, out: 3 });
    expect(sanitize(clip("a", 1, 1.05), src).out).toBeCloseTo(1.2);
    // Length not known yet: an unknown end stays "to the end".
    expect(sanitize(clip("a", 1, 0), undefined)).toMatchObject({ in: 1, out: 0 });
  });

  it("makes whole clips and reads timecode", () => {
    expect(clipFor("x", undefined).out).toBe(0);
    expect(timecode(62.5)).toBe("01:02:12");
  });
});

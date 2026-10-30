import { describe, expect, it } from "vitest";
import { labStats, matchShift, srgbToLab } from "./match";

describe("colour continuity in the browser", () => {
  it("converts to CIELAB the way the GPU node does", () => {
    const white = srgbToLab([1, 1, 1]);
    expect(white[0]).toBeCloseTo(100, 2);
    expect(Math.abs(white[1]) + Math.abs(white[2])).toBeLessThan(0.01);
    const red = srgbToLab([1, 0, 0]);
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
  });

  it("measures a picture's colour", () => {
    const grey = new Uint8ClampedArray(4 * 16).fill(128);
    const s = labStats(grey);
    expect(s.mean[1]).toBeCloseTo(0, 3);
    expect(s.std[0]).toBe(1e-3); // flat: the floor, so a match can't divide by zero
  });

  it("moves a clip onto the reference, never stretching its spread more than 2x", () => {
    const clip = { mean: [40, 5, -20] as [number, number, number], std: [10, 4, 4] as [number, number, number] };
    const ref = { mean: [60, 10, 20] as [number, number, number], std: [30, 4, 1] as [number, number, number] };
    expect(matchShift(clip, ref, false)).toEqual({ from: clip.mean, scale: [2, 1, 0.5], to: ref.mean });
    // Colour only: the clip keeps its own lightness.
    expect(matchShift(clip, ref, true)).toMatchObject({ scale: [1, 1, 0.5], to: [40, 10, 20] });
  });
});

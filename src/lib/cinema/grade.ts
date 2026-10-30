// The film looks' colour maths, as NovaLensFilm runs it on the GPU (comfyui-novafield/nova/lens_film.py).
// The grade tool previews it live in the browser; a test keeps these numbers equal to the Python ones.

import type { FilmLab } from "../engines/specs";
import type { FilmLook } from "./looks";

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

export interface LookParams {
  exposure: number;
  /** Rows are output channels: out[o] = Σ mix[o][c] · in[c]. */
  mix: Mat3;
  sat: number;
  contrast: number;
  pivot: number;
  black: Vec3;
  white: Vec3;
  shadow: Vec3;
  highlight: Vec3;
  /** Black and white: the weights each channel gives the grey. */
  mono?: Vec3;
  teal_orange?: number;
  /** Bleach bypass: how much of the luma is overlaid back (silver retention). */
  silver?: number;
  vhs?: boolean;
}

const I: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export const LOOK_PARAMS: Record<Exclude<FilmLook["id"], "none">, LookParams> = {
  kodak_2383: {
    exposure: 1.0,
    mix: [
      [1.05, -0.03, -0.02],
      [-0.02, 1.02, 0.0],
      [-0.02, -0.05, 1.07],
    ],
    sat: 1.08,
    contrast: 1.45,
    pivot: 0.42,
    black: [0.01, 0.016, 0.024],
    white: [0.98, 0.95, 0.89],
    shadow: [-0.03, 0.006, 0.028],
    highlight: [0.035, 0.012, -0.03],
  },
  fuji_eterna: {
    exposure: 1.0,
    mix: [
      [0.96, 0.06, -0.02],
      [0.0, 1.0, 0.0],
      [-0.02, 0.07, 0.95],
    ],
    sat: 0.74,
    contrast: 1.1,
    pivot: 0.45,
    black: [0.036, 0.046, 0.046],
    white: [0.94, 0.96, 0.94],
    shadow: [-0.018, 0.014, 0.01],
    highlight: [0.01, 0.01, -0.008],
  },
  bleach_bypass: {
    exposure: 1.02,
    mix: I,
    sat: 0.5,
    contrast: 1.4,
    pivot: 0.5,
    black: [0.012, 0.014, 0.018],
    white: [0.96, 0.96, 0.97],
    shadow: [-0.006, 0.0, 0.01],
    highlight: [0.004, 0.004, 0.0],
    silver: 0.22,
  },
  teal_orange: {
    exposure: 1.0,
    mix: [
      [1.04, -0.02, -0.02],
      [-0.02, 1.02, 0.0],
      [-0.02, 0.02, 1.0],
    ],
    sat: 1.05,
    contrast: 1.28,
    pivot: 0.45,
    black: [0.0, 0.022, 0.034],
    white: [1.0, 0.96, 0.9],
    shadow: [-0.06, 0.022, 0.06],
    highlight: [0.05, 0.018, -0.045],
    teal_orange: 1.0,
  },
  noir: {
    exposure: 1.03,
    mono: [0.52, 0.4, 0.08],
    mix: I,
    sat: 0.0,
    contrast: 2.0,
    pivot: 0.42,
    black: [0.0, 0.0, 0.0],
    white: [1.0, 1.0, 1.0],
    shadow: [0.0, 0.0, 0.0],
    highlight: [0.0, 0.0, 0.0],
  },
  technicolor: {
    exposure: 1.0,
    mix: [
      [1.28, -0.16, -0.12],
      [-0.12, 1.24, -0.12],
      [-0.05, -0.2, 1.25],
    ],
    sat: 1.22,
    contrast: 1.3,
    pivot: 0.45,
    black: [0.016, 0.01, 0.022],
    white: [1.0, 0.97, 0.9],
    shadow: [0.0, -0.01, 0.02],
    highlight: [0.03, 0.02, -0.02],
  },
  moonlight: {
    exposure: 0.62,
    mix: [
      [0.72, 0.18, 0.1],
      [0.1, 0.8, 0.1],
      [0.08, 0.22, 0.86],
    ],
    sat: 0.55,
    contrast: 1.25,
    pivot: 0.4,
    black: [0.008, 0.018, 0.045],
    white: [0.7, 0.82, 1.0],
    shadow: [-0.02, 0.0, 0.05],
    highlight: [-0.02, 0.01, 0.04],
  },
  vhs_1989: {
    exposure: 1.02,
    mix: [
      [1.02, 0.0, 0.0],
      [0.0, 0.97, 0.03],
      [0.02, 0.03, 0.98],
    ],
    sat: 1.18,
    contrast: 0.86,
    pivot: 0.5,
    black: [0.06, 0.05, 0.075],
    white: [0.94, 0.93, 0.91],
    shadow: [0.012, -0.01, 0.03],
    highlight: [0.025, 0.004, -0.02],
    vhs: true,
  },
  kodak_portra_400: {
    exposure: 1.02,
    mix: [
      [1.03, -0.01, -0.02],
      [-0.01, 1.01, 0],
      [-0.02, -0.02, 1.04],
    ],
    sat: 0.9,
    contrast: 1.12,
    pivot: 0.45,
    black: [0.03, 0.028, 0.03],
    white: [0.98, 0.96, 0.92],
    shadow: [-0.01, 0.008, 0.012],
    highlight: [0.03, 0.015, -0.02],
  },
  kodak_vision3_500t: {
    exposure: 1,
    mix: [
      [1.02, -0.01, -0.01],
      [-0.01, 1, 0.01],
      [0, -0.02, 1.02],
    ],
    sat: 0.95,
    contrast: 1.22,
    pivot: 0.43,
    black: [0.012, 0.02, 0.03],
    white: [0.97, 0.95, 0.92],
    shadow: [-0.025, 0.004, 0.03],
    highlight: [0.03, 0.012, -0.025],
  },
  ektachrome_e100: {
    exposure: 0.98,
    mix: [
      [1.02, -0.02, 0],
      [-0.02, 1.03, -0.01],
      [-0.01, -0.02, 1.08],
    ],
    sat: 1.2,
    contrast: 1.4,
    pivot: 0.48,
    black: [0.005, 0.008, 0.014],
    white: [0.99, 0.99, 1],
    shadow: [-0.01, 0, 0.02],
    highlight: [0, 0.006, 0.012],
  },
  cinestill_800t: {
    exposure: 1,
    mix: [
      [0.98, 0.02, 0],
      [0, 1, 0],
      [0, 0.04, 1.04],
    ],
    sat: 1.05,
    contrast: 1.25,
    pivot: 0.42,
    black: [0, 0.02, 0.035],
    white: [1, 0.95, 0.9],
    shadow: [-0.05, 0.012, 0.05],
    highlight: [0.045, 0.01, -0.03],
  },
  fuji_velvia_50: {
    exposure: 0.97,
    mix: [
      [1.12, -0.08, -0.04],
      [-0.06, 1.14, -0.08],
      [-0.03, -0.08, 1.11],
    ],
    sat: 1.4,
    contrast: 1.5,
    pivot: 0.47,
    black: [0.004, 0.006, 0.01],
    white: [1, 0.99, 0.97],
    shadow: [0, 0.006, 0.012],
    highlight: [0.01, 0.01, -0.01],
  },
  kodachrome_64: {
    exposure: 1,
    mix: [
      [1.1, -0.06, -0.04],
      [-0.04, 1.04, 0],
      [-0.02, -0.06, 1.02],
    ],
    sat: 1.15,
    contrast: 1.38,
    pivot: 0.44,
    black: [0.014, 0.01, 0.012],
    white: [0.99, 0.96, 0.86],
    shadow: [0, -0.004, 0.016],
    highlight: [0.03, 0.02, -0.04],
  },
  ilford_hp5: {
    exposure: 1,
    mono: [0.3, 0.59, 0.11],
    mix: I,
    sat: 0,
    contrast: 1.35,
    pivot: 0.45,
    black: [0.025, 0.025, 0.025],
    white: [0.97, 0.97, 0.97],
    shadow: [0, 0, 0],
    highlight: [0, 0, 0],
  },
  instant_film: {
    exposure: 1.04,
    mix: [
      [0.98, 0.04, -0.02],
      [0.02, 1, -0.02],
      [0, 0.06, 0.9],
    ],
    sat: 0.82,
    contrast: 0.9,
    pivot: 0.5,
    black: [0.09, 0.1, 0.08],
    white: [0.95, 0.94, 0.86],
    shadow: [-0.01, 0.02, 0],
    highlight: [0.03, 0.02, -0.03],
  },
  super8: {
    exposure: 1.03,
    mix: [
      [1.04, 0, -0.04],
      [0, 1, -0.02],
      [-0.02, 0.02, 0.88],
    ],
    sat: 0.92,
    contrast: 1.15,
    pivot: 0.48,
    black: [0.06, 0.045, 0.03],
    white: [0.97, 0.92, 0.8],
    shadow: [0.01, 0, -0.01],
    highlight: [0.04, 0.02, -0.04],
  },
};

/** The grade a finished take starts from: Kodak print film at its own grain, halation and vignette. */
export const DEFAULT_GRADE: FilmLab = { look: "kodak_2383", intensity: 0.8, grain: 0.35, halation: 0.3, vignette: 0.25, chromatic: 0, gateWeave: 0, streak: 0 };

/** The colour controls that come after the look (NovaField nodes 0.3.0+). All neutral at 0. */
export const COLOUR_KEYS = ["exposure", "contrast", "saturation", "temperature", "tint", "fade"] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];

/** Whether a grade uses any colour control. */
export const hasColour = (f: Partial<FilmLab>) => COLOUR_KEYS.some((k) => !!f[k]);

/** Whether a grade needs NovaField nodes 0.3.0: a newer look, a colour control or a grain size other than 1. */
export const needsNewNodes = (f: FilmLab, sinceLooks: readonly string[]) => sinceLooks.includes(f.look) || hasColour(f) || (f.grainSize ?? 1) !== 1;

/** Whether a grade changes nothing (NovaLensFilm hands the frames back untouched). */
export const isIdentity = (f: FilmLab) =>
  !(f.look !== "none" && f.intensity > 0) && !hasColour(f) && Math.max(f.grain, f.halation, f.vignette, f.chromatic, f.gateWeave, f.streak) <= 0;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const luma = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mul = (m: Mat3, c: Vec3): Vec3 => [0, 1, 2].map((o) => m[o][0] * c[0] + m[o][1] * c[1] + m[o][2] * c[2]) as Vec3;

/** Power S-curve through (0,0), (p,p), (1,1). */
function sCurve(x: number, c: number, p: number) {
  const v = clamp01(x);
  return v < p ? p * Math.max(0, v / p) ** c : 1 - (1 - p) * Math.max(0, (1 - v) / (1 - p)) ** c;
}

/**
 * One pixel through a look at full strength, as lens_film.grade() does (without the VHS blur,
 * which needs its neighbours). The shader runs the same steps; tests hold both to the Python.
 */
export function gradePixel(rgb: Vec3, look: Exclude<FilmLook["id"], "none">): Vec3 {
  const p = LOOK_PARAMS[look];
  let y: Vec3 = p.mono ? (Array(3).fill(rgb[0] * p.mono[0] + rgb[1] * p.mono[1] + rgb[2] * p.mono[2]) as Vec3) : mul(p.mix, rgb);
  y = y.map((v) => v * p.exposure) as Vec3;
  if (p.sat !== 1) {
    const L = luma(y);
    y = y.map((v) => L + (v - L) * p.sat) as Vec3;
  }
  if (p.teal_orange) {
    const k = p.teal_orange;
    const L = luma(y);
    const chroma = clamp01(Math.max(...y) - Math.min(...y));
    const warm = smoothstep(-0.1, 0.25, y[0] - y[2]);
    const teal = mul(
      [
        [0.8, 0.1, 0.1],
        [0.0, 0.7, 0.3],
        [0.0, 0.42, 0.58],
      ],
      y,
    );
    y = y.map((v, i) => v + (teal[i] - v) * (1 - warm) * k) as Vec3;
    const warmPush: Vec3 = [0.09, 0.02, -0.08];
    const coolPush: Vec3 = [-0.05, 0.012, 0.035];
    y = y.map((v, i) => v + k * (warm * chroma * warmPush[i] + (1 - warm) * (0.3 + chroma) * coolPush[i]) * (0.3 + 0.7 * L)) as Vec3;
  }
  y = y.map((v) => sCurve(v, p.contrast, p.pivot)) as Vec3;
  if (p.silver) {
    const L = luma(y);
    const s = p.silver;
    y = y.map((v) => v + ((L < 0.5 ? 2 * v * L : 1 - 2 * (1 - v) * (1 - L)) - v) * s) as Vec3;
  }
  y = y.map((v, i) => p.black[i] + v * (p.white[i] - p.black[i])) as Vec3;
  const L = clamp01(luma(y));
  y = y.map((v, i) => v + (1 - L) ** 2 * p.shadow[i] + L ** 2 * p.highlight[i]) as Vec3;
  return y.map(clamp01) as Vec3;
}

/** A pixel with the look blended in by intensity, as NovaLensFilm does before the lens effects. */
export function gradeBlend(rgb: Vec3, film: Pick<FilmLab, "look" | "intensity">): Vec3 {
  if (film.look === "none" || film.intensity <= 0) return rgb;
  const g = gradePixel(rgb, film.look);
  return rgb.map((v, i) => v + (g[i] - v) * film.intensity) as Vec3;
}

/** The colour controls on one pixel, as lens_film.adjust() does after the look. */
export function adjustPixel(rgb: Vec3, f: Partial<Record<ColourKey, number>>): Vec3 {
  let x = rgb;
  const { exposure = 0, contrast = 0, saturation = 0, temperature = 0, tint = 0, fade = 0 } = f;
  if (exposure) x = x.map((v) => v * 2 ** exposure) as Vec3;
  if (temperature || tint) {
    const gain: Vec3 = [1 + 0.12 * temperature + 0.04 * tint, 1 - 0.12 * tint, 1 - 0.12 * temperature + 0.04 * tint];
    x = x.map((v, i) => v * gain[i]) as Vec3;
  }
  if (saturation) {
    const L = luma(x);
    x = x.map((v) => L + (v - L) * (1 + saturation)) as Vec3;
  }
  if (contrast) x = x.map((v) => sCurve(v, 2 ** contrast, 0.5)) as Vec3;
  if (fade) x = x.map((v) => 0.1 * fade + clamp01(v) * (1 - 0.25 * fade)) as Vec3;
  return x.map(clamp01) as Vec3;
}

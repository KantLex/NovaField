// Colour continuity, as NovaMatchColor runs it on the GPU (comfyui-novafield/nova/match_color.py):
// a clip's mean and spread of L*, a*, b* moved onto a reference picture's. The grade sheet uses
// these to preview the match live.

type Vec3 = [number, number, number];

const M: [Vec3, Vec3, Vec3] = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const WHITE: Vec3 = [0.95047, 1.0, 1.08883];
const D = 6 / 29;

/** sRGB (0–1) to CIELAB (D65). */
export function srgbToLab(rgb: Vec3): Vec3 {
  const lin = rgb.map((c) => {
    const v = Math.min(1, Math.max(0, c));
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const f = [0, 1, 2].map((i) => {
    const t = (M[i][0] * lin[0] + M[i][1] * lin[1] + M[i][2] * lin[2]) / WHITE[i];
    return t > D ** 3 ? Math.cbrt(t) : t / (3 * D * D) + 4 / 29;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

export interface LabStats {
  mean: Vec3;
  std: Vec3;
}

/** Mean and spread of L*, a*, b* over RGBA pixels (a canvas's ImageData), sampling every `step`th pixel. */
export function labStats(rgba: ArrayLike<number>, step = 1): LabStats {
  const sum: Vec3 = [0, 0, 0];
  const sq: Vec3 = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4 * step) {
    const lab = srgbToLab([rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255]);
    for (let c = 0; c < 3; c++) {
      sum[c] += lab[c];
      sq[c] += lab[c] * lab[c];
    }
    n++;
  }
  const mean = sum.map((s) => s / Math.max(1, n)) as Vec3;
  // Sample standard deviation, as torch's std() gives.
  const std = sq.map((s, c) => Math.max(1e-3, Math.sqrt(Math.max(0, (s - n * mean[c] * mean[c]) / Math.max(1, n - 1))))) as Vec3;
  return { mean, std };
}

export interface MatchShift {
  from: Vec3;
  scale: Vec3;
  to: Vec3;
}

/** The shift a match applies in Lab: lab' = (lab − from) · scale + to. */
export function matchShift(source: LabStats, reference: LabStats, colourOnly: boolean): MatchShift {
  const scale = reference.std.map((s, c) => Math.min(2, Math.max(0.5, s / source.std[c]))) as Vec3;
  const to: Vec3 = [...reference.mean];
  if (colourOnly) {
    scale[0] = 1;
    to[0] = source.mean[0];
  }
  return { from: source.mean, scale, to };
}

// Put a form's values back into the workflow, and let Studio drive any workflow by role.

import type { ApiGraph, InputValue } from "../comfy/graph";
import { blockingMissing } from "./missing";
import type { Field, Recipe } from "./types";
import { say } from "@/lib/say";

export type Values = Record<string, InputValue>;

/** Snap to the field's own grid: min + k·step, clamped. */
export function snap(f: Field, v: number): number {
  const step = f.step && f.step > 0 ? f.step : f.integer ? 1 : 0;
  let x = v;
  if (step) x = (f.min ?? 0) + Math.round((x - (f.min ?? 0)) / step) * step;
  if (f.min !== undefined) x = Math.max(f.min, x);
  if (f.max !== undefined) x = Math.min(f.max, x);
  return f.integer ? Math.round(x) : x;
}

/** Aspect ratios offered for any workflow with a width and a height. */
export const SIZE_RATIOS: { id: string; ratio: number }[] = [
  { id: "1:1", ratio: 1 },
  { id: "4:5", ratio: 4 / 5 },
  { id: "3:4", ratio: 3 / 4 },
  { id: "2:3", ratio: 2 / 3 },
  { id: "9:16", ratio: 9 / 16 },
  { id: "16:9", ratio: 16 / 9 },
  { id: "3:2", ratio: 3 / 2 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "21:9", ratio: 21 / 9 },
];

/** Pixel-count multipliers: the same shape with fewer or more pixels. */
export const SIZE_SCALES = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

/**
 * Width and height for an aspect ratio and a pixel count. `area` is the pixels wanted (the
 * workflow's own size × a multiplier). Sides land on multiples of 16, which every latent model
 * accepts, and within the fields' own limits.
 */
export function sizeFor(w: Field, h: Field, ratio: number, area: number): { width: number; height: number } {
  const grid = Math.max(16, w.step ?? 0, h.step ?? 0);
  const side = (f: Field, v: number) => snap(f, Math.max(grid, Math.round(v / grid) * grid));
  return { width: side(w, Math.sqrt(area * ratio)), height: side(h, Math.sqrt(area / ratio)) };
}

export const randomSeed = (f?: Field) => Math.floor(Math.random() * Math.min(f?.max ?? 2 ** 47, 2 ** 47));

/** The graph to queue: defaults, then the values given; randomised seeds get a fresh draw. */
export function applyValues(recipe: Pick<Recipe, "graph" | "fields">, values: Values): { graph: ApiGraph; used: Values } {
  const graph = structuredClone(recipe.graph);
  const used: Values = {};
  for (const f of recipe.fields) {
    let v = f.id in values ? values[f.id] : f.value;
    if (f.kind === "seed" && f.randomize && !(f.id in values)) v = randomSeed(f);
    if (f.kind === "number" && typeof v === "number") v = snap(f, v);
    if (!graph[f.node]) continue;
    graph[f.node].inputs[f.input] = v;
    used[f.id] = v;
  }
  return { graph, used };
}

export interface ShotFill {
  prompt: string;
  /** Pixel aspect the shot asks for. */
  aspect: number;
  seconds: number;
  seed: number;
  firstFrame?: string;
  cast: string[];
}

/**
 * Map a Studio shot onto a workflow by role: prompt, first frame and cast pictures, seed, and
 * size (keeping the workflow's own pixel budget, reshaped to the shot's aspect) and length.
 */
export function fillForShot(recipe: Recipe, shot: ShotFill): { values: Values; notes: string[] } {
  const values: Values = {};
  const notes: string[] = [];
  const by = (role: Field["role"]) => recipe.fields.filter((f) => f.role === role);

  const prompt = by("prompt")[0];
  if (prompt) values[prompt.id] = shot.prompt;
  else notes.push("This workflow has no prompt field, so the script is not used.");

  const images = by("image");
  const pictures = [shot.firstFrame, ...shot.cast].filter((x): x is string => !!x);
  images.forEach((f, i) => {
    if (pictures[i]) values[f.id] = pictures[i];
  });
  if (pictures.length > images.length)
    notes.push(
      images.length === 1
        ? say("This workflow takes one picture; the rest of the cast is left out.")
        : say("This workflow takes {n} pictures; the rest of the cast is left out.", { n: images.length }),
    );

  for (const f of by("seed")) values[f.id] = shot.seed % Math.min(f.max ?? 2 ** 47, 2 ** 47);

  const w = by("width")[0];
  const h = by("height")[0];
  if (w && h && typeof w.value === "number" && typeof h.value === "number") {
    const size = sizeFor(w, h, shot.aspect, w.value * h.value);
    values[w.id] = size.width;
    values[h.id] = size.height;
  }

  // Aspect dropdowns ("16:9 (Widescreen)"): pick the option closest to the shot.
  const aspect = by("aspect")[0];
  if (aspect?.options) {
    const ratio = (o: string) => {
      const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/.exec(o);
      return m ? Number(m[1]) / Number(m[2]) : NaN;
    };
    const best = aspect.options.filter((o) => !Number.isNaN(ratio(o))).sort((a, b) => Math.abs(Math.log(ratio(a) / shot.aspect)) - Math.abs(Math.log(ratio(b) / shot.aspect)))[0];
    if (best) values[aspect.id] = best;
  }

  const secs = by("seconds")[0];
  const frames = by("frames")[0];
  if (secs) values[secs.id] = snap(secs, shot.seconds);
  else if (frames) values[frames.id] = snap(frames, Math.round(shot.seconds * (recipe.fps ?? 24)));

  return { values, notes };
}

/** Whether Studio can drive this workflow: it needs a prompt and a picture or video out. */
export const isEngine = (r: Pick<Recipe, "fields" | "output" | "missing">) =>
  blockingMissing(r.missing).length === 0 && r.fields.some((f) => f.role === "prompt") && (r.output === "video" || r.output === "image");

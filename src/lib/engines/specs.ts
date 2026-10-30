// What the UI asks for. Engines compile these into ComfyUI graphs.

import type { Angle, Lens, MoveLayer, ShotSize } from "../cinema/moves";
import type { FilmLook } from "../cinema/looks";
import type { CustomRig, Timing } from "../cinema/custom";
import type { InputValue } from "../comfy/graph";

export type Quality = "draft" | "studio" | "master";
export type Aspect = "16:9" | "9:16" | "1:1" | "2.39:1" | "4:3";

/** A file that already sits in the ComfyUI input folder. */
export interface Asset {
  name: string;
  kind: "image" | "video" | "audio";
  /** Browser-viewable preview (served by the app). */
  url: string;
  label?: string;
  /** The library asset it came from: pictures sharing a group are one character, object or place. */
  group?: string;
  /** That asset's description, for the prompt. */
  note?: string;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  frames?: number;
}

export interface FilmLab {
  look: FilmLook["id"];
  intensity: number;
  grain: number;
  halation: number;
  vignette: number;
  chromatic: number;
  gateWeave: number;
  streak: number;
  /** Colour after the look (NovaField nodes 0.3.0+); missing means neutral. Exposure is in stops. */
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  fade?: number;
  /** Grain blur, 1 = as before. */
  grainSize?: number;
}

/** Parts of the director's panel a shot can do without. */
export type ShotSection = "framing" | "move" | "light" | "film";

/**
 * A shot with its switched-off sections taken out: no camera move (and no ghost rig), no film lab.
 * Framing and light only feed the prompt, which leaves them out itself.
 */
export function withSectionsOff<T extends ShotSpec>(spec: T): T {
  const off = spec.off ?? {};
  if (!off.move && !off.film) return spec;
  return {
    ...spec,
    ...(off.move ? { move: "locked", combo: null, rig: null, shake: 0, cameraMode: "prompt" as const } : {}),
    ...(off.film ? { filmOnGpu: false, film: { ...spec.film, look: "none" } } : {}),
  };
}

export interface ShotSpec {
  kind: "shot";
  prompt: string;
  cast: Asset[];
  startFrame?: Asset;
  endFrame?: Asset;
  size: ShotSize;
  angle: Angle;
  lens: Lens;
  move: string;
  intensity: number;
  /** Stacked moves ("push in" + "pan left" then "crane up"); replaces `move` when non-empty. */
  combo?: MoveLayer[] | null;
  /** Hand-edited marks and stand-ins; replaces the preset move when set. */
  rig?: CustomRig | null;
  timing?: Timing;
  /** Extra handheld shake on top of any move, 0–1. */
  shake?: number;
  /** "rig": render the move on the GPU and hand it to H3 as a motion reference. */
  cameraMode: "rig" | "prompt";
  /**
   * A previs clip the user brought (a Blender or Unreal blockout, a phone walk-through, an
   * animatic): H3 follows its camera, and with "action" its blocking too, in place of the preset move.
   */
  previs?: { clip: Asset; follow: "camera" | "action" } | null;
  rigStyle: "subject" | "stage" | "starfield" | "parallax";
  lighting: string;
  film: FilmLab;
  /** Apply the film lab on the GPU (needs the NovaField pack); otherwise only the prompt mentions the stock. */
  filmOnGpu: boolean;
  /** Director's panel sections switched off: the shot leaves that direction to the prompt. */
  off?: Partial<Record<ShotSection, boolean>>;
  aspect: Aspect;
  quality: Quality;
  duration: number;
  seed: number;
  turbo: boolean;
  smooth: boolean;
  sound: boolean;
  /** Render through one of the user's imported workflows instead of MiniMax H3 (a recipe id). */
  engine?: string | null;
  /** Continue from the end of an earlier take. The tail clip is uploaded by the runner. */
  extend?: { fromJob: string; tail?: Asset; overlapFrames: number };
}

export interface RecastSpec {
  kind: "recast";
  source: Asset;
  character: Asset;
  extras: Asset[];
  notes: string;
  audio: "original" | "generated" | "none";
  quality: Quality;
  seed: number;
}

export interface RestyleSpec {
  kind: "restyle";
  source: Asset;
  styleRef?: Asset;
  style: string;
  film: FilmLab;
  filmOnGpu: boolean;
  audio: "original" | "generated" | "none";
  quality: Quality;
  seed: number;
}

export interface BoxKey {
  f: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReplaceSpec {
  kind: "replace";
  /** Pre-processed to 16 fps at the Wan working size. */
  source: Asset;
  shape: "rect" | "ellipse";
  keys: BoxKey[];
  /** Margin added around the box, as a share of its size (default 0.06). */
  expand?: number;
  /** Soft edge outside the margin, as a share of the size (default 0.1). */
  feather?: number;
  replacement?: Asset;
  prompt: string;
  seed: number;
}

export interface PathPoint {
  x: number;
  y: number;
}

/** When a path's thing moves: a span of the clip (0–1) and how it speeds up and slows down. */
export interface PathTiming {
  start: number;
  end: number;
  ease: "smooth" | "linear" | "in" | "out";
}

export interface PathsSpec {
  kind: "paths";
  image: Asset;
  /** Each path is a polyline in 0–1 image coordinates, first point = where the thing starts. */
  paths: PathPoint[][];
  /** Per path, by index; missing entries move across the whole clip, easing in and out. */
  timing?: PathTiming[];
  prompt: string;
  aspect: Aspect;
  seed: number;
}

/** Run an imported ComfyUI workflow with the values from its form. */
export interface WorkflowSpec {
  kind: "workflow";
  recipe: string;
  values: Record<string, InputValue>;
}

/** What the picture tools do: change it from words, add pixels and detail, or widen the frame. */
export type ImageTool = "edit" | "upscale" | "expand";
export type ImageModel = "qwen" | "kontext";

/** One step on a picture in the Image page. The result is a new picture; the source is kept. */
export interface ImageSpec {
  kind: "image";
  tool: ImageTool;
  /** The picture to work on, in the ComfyUI input folder (with its size, for the maths). */
  image: Asset;
  /** Edit: the change in words. Upscale: what the picture shows (guides the new detail). Expand: what fills the new space. */
  prompt: string;
  /** Edit and expand: which editing model; the first installed one when unset. */
  model?: ImageModel;
  /** Upscale: how much to enlarge (1.5–2), capped so the result stays under ~4 megapixels. */
  scale?: number;
  /** Upscale: 0 keeps the picture as it is, 1 lets the model invent more detail. */
  creativity?: number;
  /** Expand: the frame to widen to. */
  aspect?: Aspect;
  /** The take this picture came from, so the Image page can show its history and compare. */
  from?: string;
  seed: number;
}

/** A film look and lens character laid over a finished clip by NovaLensFilm: no model, sound kept. */
export interface GradeSpec {
  kind: "grade";
  /** The clip as it is, in the ComfyUI input folder (with its size, frame rate and length). */
  source: Asset;
  film: FilmLab;
  /** The take it grades, so the new one can be compared with it. */
  from?: string;
  /** Continuity: the clip's colour moved onto another shot's (NovaMatchColor). */
  match?: GradeMatch;
  /** Shutter motion blur and speed (NovaShutter, after frame interpolation). */
  motion?: GradeMotion;
  seed: number;
}

export interface GradeMatch {
  /** A frame of the shot to match, in the ComfyUI input folder. */
  reference: Asset;
  /** 0–1. */
  amount: number;
  /** Keep the clip's own brightness and contrast; match only its colour. */
  colourOnly: boolean;
}

export interface GradeMotion {
  /** Degrees: 0 keeps every frame sharp, 180 is the film standard, 360 the softest. */
  shutter: number;
  /** 1 is real time; 0.5 half speed, 2 double. */
  speed: number;
}

export type JobSpec = ShotSpec | RecastSpec | RestyleSpec | ReplaceSpec | PathsSpec | WorkflowSpec | ImageSpec | GradeSpec;
export type JobKind = JobSpec["kind"];

export const KIND_LABEL: Record<JobKind, string> = {
  shot: "Shot",
  recast: "Recast",
  restyle: "Restyle",
  replace: "Replace",
  paths: "Motion paths",
  workflow: "Workflow",
  image: "Image",
  grade: "Grade",
};

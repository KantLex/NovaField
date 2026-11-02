// Which model does each Henshin mode: the choices, the two recommended for each, what each needs
// on the server, and which kind of clip it takes. The first one listed for a mode is its default.
// An imported workflow can run a mode too, when it takes what the mode gives it.

import { isEngine } from "../workflows/apply";
import type { Recipe } from "../workflows/types";
import type { Capabilities } from "./capabilities";
import { MODELS } from "./capabilities";
import type { JobSpec, PathsSpec, RecastSpec, ReplaceSpec, RestyleSpec } from "./specs";

export type HenshinKind = "recast" | "restyle" | "replace" | "paths";
export type HenshinModel = "h3" | "scail" | "vace" | "h3-control" | "wanmove" | "ati";

export interface HenshinModelInfo {
  /** "workflow" stands for an imported workflow chosen on the page. */
  id: HenshinModel | "workflow";
  /** Its name in the picker (a product name, not translated). */
  name: string;
  /** What it's good at, in a sentence. */
  blurb: string;
  /** One of the two recommended for its mode. */
  recommended: boolean;
  /** The clip it takes: H3's (24 fps, up to 15 s) or Wan's (16 fps, 5 s). Motion paths take a still. */
  clip: "h3" | "wan" | "image";
  /** It can make new sound (the others keep the clip's sound or stay silent). */
  sound: boolean;
  /** Draft and Studio quality apply (Wan models run at one size). */
  quality: boolean;
  /** Files it loads, for the "not installed" message and the docs. */
  files: string[];
}

export const HENSHIN_MODELS: Record<HenshinKind, HenshinModelInfo[]> = {
  recast: [
    {
      id: "h3",
      name: "MiniMax H3",
      blurb: "Reference-to-video. Keeps the camera, light and sound; up to 15 s; you can pick who changes.",
      recommended: true,
      clip: "h3",
      sound: true,
      quality: true,
      files: [MODELS.h3Ref2v, MODELS.h3Clip, MODELS.h3Vae, MODELS.h3AudioVae],
    },
    {
      id: "scail",
      name: "SCAIL-2",
      blurb: "Built for swapping a person: tracks their pose and shape frame by frame. 5 s at 16 fps; recasts the biggest person.",
      recommended: true,
      clip: "wan",
      sound: false,
      quality: false,
      files: [MODELS.scail, MODELS.scailDpo, MODELS.sam3, MODELS.wanClip, MODELS.wanVae, MODELS.clipVision],
    },
  ],
  restyle: [
    {
      id: "h3",
      name: "MiniMax H3",
      blurb: "Reference-to-video. Free to reinterpret materials and light; up to 15 s, with sound.",
      recommended: true,
      clip: "h3",
      sound: true,
      quality: true,
      files: [MODELS.h3Ref2v, MODELS.h3Clip, MODELS.h3Vae, MODELS.h3AudioVae],
    },
    {
      id: "vace",
      name: "Wan 2.1 VACE",
      blurb: "Follows the clip's edges frame by frame, so shapes and timing hold under heavy styles. 5 s at 16 fps.",
      recommended: true,
      clip: "wan",
      sound: false,
      quality: false,
      files: [MODELS.wanVace, MODELS.wanClip, MODELS.wanVae],
    },
  ],
  replace: [
    {
      id: "vace",
      name: "Wan 2.1 VACE",
      blurb: "Repaints only inside the tracked box; everything else is the original. 5 s at 16 fps.",
      recommended: true,
      clip: "wan",
      sound: false,
      quality: false,
      files: [MODELS.wanVace, MODELS.wanClip, MODELS.wanVae],
    },
    {
      id: "h3-control",
      name: "MiniMax H3 + Fun ControlNet",
      blurb: "Repaints inside the tracked box at 24 fps, up to 15 s, keeping the clip's sound.",
      recommended: true,
      clip: "h3",
      sound: false,
      quality: true,
      files: [MODELS.h3Ref2v, MODELS.h3FunControl, MODELS.h3Clip, MODELS.h3Vae, MODELS.h3AudioVae],
    },
  ],
  paths: [
    {
      id: "wanmove",
      name: "Wan 2.1 + WanMove",
      blurb: "Each path drags the point under it; pinned points stay put.",
      recommended: true,
      clip: "image",
      sound: false,
      quality: false,
      files: [MODELS.wanI2v, MODELS.clipVision, MODELS.wanClip, MODELS.wanVae],
    },
    {
      id: "ati",
      name: "Wan 2.1 ATI",
      blurb: "Trajectory model trained on the same kind of point paths; often looser, livelier motion.",
      recommended: true,
      clip: "image",
      sound: false,
      quality: false,
      files: [MODELS.wanAti, MODELS.clipVision, MODELS.wanClip, MODELS.wanVae],
    },
  ],
};

/** The model a job uses: the one asked for when the mode has it, else the mode's default. */
export function henshinModel(kind: HenshinKind, model?: string): HenshinModelInfo {
  const list = HENSHIN_MODELS[kind];
  return list.find((m) => m.id === model) ?? list[0];
}

/** Can the connected server run this model for this mode? */
export function henshinReady(kind: HenshinKind, model: HenshinModelInfo["id"], caps: Capabilities): boolean {
  switch (`${kind}:${model}`) {
    case "recast:h3":
    case "restyle:h3":
      return caps.h3Ref;
    case "recast:scail":
      return caps.scail;
    case "restyle:vace":
      return caps.vace;
    case "replace:vace":
      return caps.vace && caps.pack.boxTrack;
    case "replace:h3-control":
      return caps.h3FunControl && caps.pack.boxTrack;
    case "paths:wanmove":
      return caps.wanMove;
    case "paths:ati":
      return caps.ati;
    default:
      return false;
  }
}

export const isHenshin = (spec: JobSpec): spec is RecastSpec | RestyleSpec | ReplaceSpec | PathsSpec =>
  spec.kind === "recast" || spec.kind === "restyle" || spec.kind === "replace" || spec.kind === "paths";

/**
 * Can an imported workflow run this mode? It must make video from words and take the mode's
 * footage: a clip (and a picture of the character, for Recast), or a still for Motion paths.
 */
export function workflowFits(r: Pick<Recipe, "fields" | "output" | "missing">, kind: HenshinKind): boolean {
  if (!isEngine(r) || r.output !== "video") return false;
  const has = (role: string) => r.fields.some((f) => f.role === role);
  return kind === "paths" ? has("image") : kind === "recast" ? has("video") && has("image") : has("video");
}

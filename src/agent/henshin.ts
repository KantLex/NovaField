// Turning an agent's description of a Henshin job (recast, restyle, replace, animate) into the
// app's specs, with the Henshin page's defaults and limits. The clips and pictures arrive already
// placed in ComfyUI (see mcp.ts); this only checks and shapes the rest.

import { LOOKS } from "@/lib/cinema/looks";
import { HENSHIN_MODELS, type HenshinKind, type HenshinModelInfo } from "@/lib/engines/henshinModels";
import { nearestAspect } from "@/lib/engines/sizing";
import type { Asset, BoxKey, PathPoint, PathsSpec, PathTiming, Quality, RecastSpec, ReplaceSpec, RestyleSpec } from "@/lib/engines/specs";
import { clampBox, DEFAULT_TIMING, FRAME_MOVES, frameMove, type FrameMove } from "@/lib/engines/tracks";
import { DEFAULT_FILM, randomSeed } from "./shot";

export type Sound = "original" | "generated" | "none";

/** Wan models run at 16 fps (H3 at 24); box keyframes count frames at the clip's rate. */
export const WAN_FPS = 16;
export const MAX_EXTRAS = 3;
export const MAX_PATHS = 24;

const inUnit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;

/** The model a Henshin job runs on, by id (default: the mode's first); an unknown id names the choices. */
export function modelFor(kind: HenshinKind, model?: string): HenshinModelInfo {
  const list = HENSHIN_MODELS[kind];
  if (!model) return list[0];
  const m = list.find((x) => x.id === model);
  if (!m) throw new Error(`"${model}" isn't a model for ${kind}: use ${list.map((x) => x.id).join(" or ")}.`);
  return m;
}

/** The clip a mode's model takes: H3's (24 fps, up to 15 s) or Wan's (16 fps, 5 s). An imported workflow gets H3's. */
export const clipPurpose = (kind: "recast" | "restyle" | "replace", model?: string, workflow?: string) => (workflow || modelFor(kind, model).clip === "h3" ? "h3" : "wan");

/** An imported workflow to run instead of the built-in models (its id, from list_engines). */
const engineOf = (workflow?: string) => (workflow?.trim() ? { engine: workflow.trim() } : {});

export function recastSpec(o: { model?: string; workflow?: string; source: Asset; character: Asset; extras?: Asset[]; notes?: string; audio?: Sound; quality?: Quality; seed?: number }): RecastSpec {
  if ((o.extras?.length ?? 0) > MAX_EXTRAS) throw new Error(`A recast takes at most ${MAX_EXTRAS} extra pictures (other people or props in the clip).`);
  return { kind: "recast", model: modelFor("recast", o.model).id as RecastSpec["model"], ...engineOf(o.workflow), source: o.source, character: o.character, extras: o.extras ?? [], notes: o.notes?.trim() ?? "", audio: o.audio ?? "original", quality: o.quality ?? "draft", seed: o.seed ?? randomSeed() };
}

export function restyleSpec(o: { model?: string; workflow?: string; source: Asset; style?: string; styleRef?: Asset; look?: string; audio?: Sound; quality?: Quality; seed?: number }): RestyleSpec {
  const style = o.style?.trim() ?? "";
  if (!style && !o.styleRef) throw new Error("Describe the new style, or give a style picture (or both).");
  const look = o.look ?? "none";
  if (!LOOKS.some((l) => l.id === look)) throw new Error(`unknown film look "${look}"`);
  return {
    kind: "restyle",
    model: modelFor("restyle", o.model).id as RestyleSpec["model"],
    ...engineOf(o.workflow),
    source: o.source,
    ...(o.styleRef ? { styleRef: o.styleRef } : {}),
    style,
    film: { ...DEFAULT_FILM, look: look as RestyleSpec["film"]["look"] },
    filmOnGpu: look !== "none",
    audio: o.audio ?? "original",
    quality: o.quality ?? "draft",
    seed: o.seed ?? randomSeed(),
  };
}

/** A box in 0–1 frame coordinates (x, y its top-left), at `at` seconds into the clip (default 0). */
export interface BoxAt {
  x: number;
  y: number;
  w: number;
  h: number;
  at?: number;
}

/** Keyframes on a clip at `fps`: one per frame (a later box on the same frame wins), in order. */
export function boxKeys(boxes: BoxAt[], frames: number, fps = WAN_FPS): BoxKey[] {
  if (!boxes.length) throw new Error("Give at least one box around the thing to replace.");
  const last = Math.max(0, frames - 1);
  const byFrame = new Map<number, BoxKey>();
  for (const [i, b] of boxes.entries()) {
    if (![b.x, b.y, b.w, b.h].every(inUnit)) throw new Error(`Box ${i + 1}: x, y, w and h are fractions of the frame, from 0 to 1.`);
    if (b.w < 0.02 || b.h < 0.02) throw new Error(`Box ${i + 1} is too small; make it at least 2% of the frame each way.`);
    const f = Math.min(last, Math.max(0, Math.round((b.at ?? 0) * fps)));
    byFrame.set(f, { f, ...clampBox(b) });
  }
  return [...byFrame.values()].sort((a, b) => a.f - b.f);
}

export function replaceSpec(o: { model?: string; workflow?: string; source: Asset; boxes: BoxAt[]; shape?: "rect" | "ellipse"; prompt?: string; replacement?: Asset; quality?: Quality; seed?: number }): ReplaceSpec {
  const prompt = o.prompt?.trim() ?? "";
  if (!prompt && !o.replacement) throw new Error("Say what the thing becomes, or give a picture of it (or both).");
  const model = modelFor("replace", o.model);
  return {
    kind: "replace",
    model: model.id as ReplaceSpec["model"],
    ...engineOf(o.workflow),
    source: o.source,
    shape: o.shape ?? "rect",
    keys: boxKeys(o.boxes, o.source.frames ?? 81, o.source.fps ?? (o.workflow || model.clip === "h3" ? 24 : WAN_FPS)),
    ...(model.quality ? { quality: o.quality ?? "draft" } : {}),
    ...(o.replacement ? { replacement: o.replacement } : {}),
    prompt: prompt || "the replacement object",
    seed: o.seed ?? randomSeed(),
  };
}

/** One motion path: points in 0–1 picture coordinates (one point pins it still), and when it moves. */
export interface PathInput {
  points: [number, number][];
  /** When it starts and stops moving, as fractions of the clip (default 0 and 1). */
  start?: number;
  end?: number;
  ease?: PathTiming["ease"];
}

export function pathsFrom(input: PathInput[], frame?: { move: FrameMove; amount?: number }): { paths: PathPoint[][]; timing: PathTiming[] } {
  const paths: PathPoint[][] = [];
  const timing: PathTiming[] = [];
  for (const [i, p] of input.entries()) {
    if (!p.points.length) throw new Error(`Path ${i + 1} has no points.`);
    if (!p.points.every(([x, y]) => inUnit(x) && inUnit(y))) throw new Error(`Path ${i + 1}: points are [x, y] fractions of the picture, from 0 to 1.`);
    const start = p.start ?? 0;
    const end = p.end ?? 1;
    if (!inUnit(start) || !inUnit(end) || end - start < 0.05) throw new Error(`Path ${i + 1}: start and end are fractions of the clip (0 to 1), with end after start.`);
    paths.push(p.points.map(([x, y]) => ({ x, y })));
    timing.push({ start, end, ease: p.ease ?? DEFAULT_TIMING.ease });
  }
  // A frame move adds a grid of points that all move together, like a camera.
  if (frame) {
    if (!FRAME_MOVES.some((m) => m.id === frame.move)) throw new Error(`unknown frame move "${frame.move}" (${FRAME_MOVES.map((m) => m.id).join(", ")})`);
    for (const path of frameMove(frame.move, frame.amount)) {
      paths.push(path);
      timing.push(DEFAULT_TIMING);
    }
  }
  if (!paths.length) throw new Error("Draw at least one path, or give a frame move.");
  if (paths.length > MAX_PATHS) throw new Error(`At most ${MAX_PATHS} paths, frame-move points included.`);
  return { paths, timing };
}

export function pathsSpec(o: { model?: string; workflow?: string; image: Asset; paths: PathInput[]; frame?: { move: FrameMove; amount?: number }; prompt?: string; seed?: number }): PathsSpec {
  const { paths, timing } = pathsFrom(o.paths, o.frame);
  const aspect = o.image.width && o.image.height ? nearestAspect(o.image.width, o.image.height) : "16:9";
  return { kind: "paths", model: modelFor("paths", o.model).id as PathsSpec["model"], ...engineOf(o.workflow), image: o.image, paths, timing, prompt: o.prompt?.trim() ?? "", aspect, seed: o.seed ?? randomSeed() };
}

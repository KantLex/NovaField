// Recipes as engines: a workflow job, or a Studio shot or Henshin job driven through the user's own workflow.

import { shotPath } from "../cinema/custom";
import { whoAt, type Compiled } from "../engines/h3";
import { composeShotPrompt, resolveMentions } from "../engines/prompt";
import { ASPECTS, H3_FPS } from "../engines/sizing";
import type { Asset, PathsSpec, RecastSpec, ReplaceSpec, RestyleSpec, ShotSpec, WorkflowSpec } from "../engines/specs";
import { applyValues, fillForShot, type Values } from "./apply";
import type { Recipe } from "./types";
import { say } from "@/lib/say";

function metaFor(recipe: Recipe, used: Values, prompt: string, notes: string[]): Compiled["meta"] {
  const num = (role: string) => {
    const f = recipe.fields.find((x) => x.role === role);
    const v = f ? used[f.id] : undefined;
    return typeof v === "number" ? v : 0;
  };
  const fps = recipe.fps ?? 24;
  const frames = num("frames") || Math.round(num("seconds") * fps);
  return {
    engine: recipe.name,
    prompt,
    width: num("width"),
    height: num("height"),
    frames,
    fps,
    seconds: num("seconds") || frames / fps,
    trimHead: 0,
    ...(recipe.output !== "unknown" ? { output: recipe.output } : {}),
    notes,
  };
}

export function compileWorkflow(spec: WorkflowSpec, recipe: Recipe): Compiled {
  const { graph, used } = applyValues(recipe, spec.values);
  const promptField = recipe.fields.find((f) => f.role === "prompt");
  return { graph, meta: metaFor(recipe, used, promptField ? String(used[promptField.id] ?? "") : "", recipe.warnings) };
}

export function compileRecipeShot(shot: ShotSpec, recipe: Recipe): Compiled {
  // An image workflow makes a still: no camera move, no sound, nothing about time in the prompt.
  const spec: ShotSpec = recipe.output === "image" ? { ...shot, off: { ...shot.off, move: true }, sound: false } : shot;
  const path = shotPath({
    move: spec.move,
    combo: spec.combo,
    size: spec.size,
    angle: spec.angle,
    lens: spec.lens,
    intensity: spec.intensity,
    rig: spec.rig,
    timing: spec.timing,
    shake: spec.shake,
    frames: Math.round(spec.duration * H3_FPS),
    fps: H3_FPS,
  });
  // The camera can't be fed to an arbitrary workflow as a guide video, so it goes into words.
  // H3-based workflows understand <Picture N> tags; anything else gets plain names.
  const h3 = Object.values(recipe.graph).some((n) => n.class_type.startsWith("MiniMaxH3"));
  const prompt = composeShotPrompt(spec, { startFrame: !!spec.startFrame, path, plain: !h3 });
  const { values, notes } = fillForShot(recipe, {
    prompt,
    aspect: ASPECTS.find((a) => a.id === spec.aspect)?.ratio ?? 16 / 9,
    seconds: spec.duration,
    seed: spec.seed,
    firstFrame: spec.startFrame?.name,
    cast: spec.cast.map((c) => c.name),
  });
  const { graph, used } = applyValues(recipe, values);
  return { graph, meta: metaFor(recipe, used, prompt, [...notes, ...recipe.warnings]) };
}

/** Where a point (0–1 of the frame) is, in words: "on the left", "at the top right", "in the middle". */
function placeOf(x: number, y: number): string {
  const across = x < 0.36 ? "left" : x > 0.64 ? "right" : "";
  const down = y < 0.36 ? "top" : y > 0.64 ? "bottom" : "";
  return across && down ? `at the ${down} ${across}` : across ? `on the ${across}` : down ? `at the ${down}` : "in the middle";
}

/**
 * A Henshin job through the user's own workflow: the clip goes to its video input, the pictures to
 * its image inputs, and what NovaField's own models are told goes into its prompt in plain words.
 * What a workflow has no input for (a box track, drawn paths) is described there too.
 */
export function compileRecipeHenshin(spec: RecastSpec | RestyleSpec | ReplaceSpec | PathsSpec, recipe: Recipe): Compiled {
  const notes: string[] = [];
  let prompt: string;
  let pictures: Asset[];
  if (spec.kind === "recast") {
    pictures = [spec.character, ...spec.extras];
    const direction = resolveMentions(spec.notes.trim(), pictures).replace(/[.\s]+$/, "");
    prompt = [
      `Replace ${spec.target ? whoAt(spec.target) : "the main person"} in the video with the person in the reference picture${spec.extras.length ? "; the other pictures are the other people or props" : ""}.`,
      `Keep their body motion, gestures, timing, facial performance, the camera movement and framing${direction ? "" : " and the background"} exactly as in the video.`,
      direction ? `Direction: ${direction}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  } else if (spec.kind === "restyle") {
    pictures = spec.styleRef ? [spec.styleRef] : [];
    prompt = [
      `Re-create the video shot for shot in a new visual style${spec.styleRef ? " taken from the reference picture" : ""}: ${spec.style.trim() || "the reference style"}.`,
      "Keep every movement, its timing, the camera path, the composition and the performances identical; change only rendering, materials, palette and lighting.",
    ].join(" ");
  } else if (spec.kind === "replace") {
    pictures = spec.replacement ? [spec.replacement] : [];
    const first = spec.keys[0];
    const at = first ? ` ${placeOf(first.x + first.w / 2, first.y + first.h / 2)} of the frame` : "";
    prompt = `In the video, replace the thing${at} with ${spec.prompt.trim().replace(/[.\s]+$/, "")}${spec.replacement ? ", looking like the reference picture" : ""}. Keep everything else exactly as it is.`;
    notes.push(say("Your workflow has no input for the box track, so where the thing is goes into its prompt in words."));
  } else {
    pictures = [spec.image];
    const moves = spec.paths
      .filter((p) => p.length > 1)
      .map((p) => `the thing ${placeOf(p[0].x, p[0].y)} moves ${placeOf(p.at(-1)!.x, p.at(-1)!.y).replace(/^(on|at|in) the /, "to the ")}`);
    prompt = [`${spec.prompt.trim().replace(/[.\s]+$/, "") || "Natural, smooth motion"}.`, moves.length ? `${moves.join("; ").replace(/^t/, "T")}.` : "", spec.paths.some((p) => p.length === 1) ? "Some things stay still." : ""]
      .filter(Boolean)
      .join(" ");
    notes.push(say("Your workflow has no input for drawn paths, so the motion goes into its prompt in words."));
  }

  const frame = spec.kind === "paths" ? spec.image : spec.source;
  const { values, notes: filled } = fillForShot(recipe, {
    prompt,
    aspect: frame.width && frame.height ? frame.width / frame.height : 16 / 9,
    seconds: spec.kind === "paths" ? 5 : (spec.source.duration ?? 5),
    seed: spec.seed,
    cast: pictures.map((p) => p.name),
    videos: spec.kind === "paths" ? [] : [spec.source.name],
  });
  const { graph, used } = applyValues(recipe, values);
  return { graph, meta: metaFor(recipe, used, prompt, [...notes, ...filled, ...recipe.warnings]) };
}

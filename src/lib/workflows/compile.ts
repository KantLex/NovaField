// Recipes as engines: a workflow job, or a Studio shot driven through the user's own workflow.

import { shotPath } from "../cinema/custom";
import type { Compiled } from "../engines/h3";
import { composeShotPrompt } from "../engines/prompt";
import { ASPECTS, H3_FPS } from "../engines/sizing";
import type { ShotSpec, WorkflowSpec } from "../engines/specs";
import { applyValues, fillForShot, type Values } from "./apply";
import type { Recipe } from "./types";

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

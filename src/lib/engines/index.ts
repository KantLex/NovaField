import { blockingMissing } from "../workflows/missing";
import type { Recipe } from "../workflows/types";
import { compileRecipeShot, compileWorkflow } from "../workflows/compile";
import type { Capabilities } from "./capabilities";
import { compileRecastOrRestyle, compileShot, type Compiled } from "./h3";
import { compileGrade, gradeBlocker } from "./grade";
import { compileImage, imageBlocker } from "./image";
import { withSectionsOff, type JobSpec } from "./specs";
import { compilePaths, compileReplace } from "./wan";
import { say } from "@/lib/say";

export type { Compiled };

/** Imported workflows the compiler may need, looked up by id (loaded by the caller). */
export interface CompileContext {
  recipes?: Record<string, Recipe | null | undefined>;
}

export const recipeIdOf = (spec: JobSpec) => (spec.kind === "workflow" ? spec.recipe : spec.kind === "shot" ? (spec.engine ?? null) : null);

export function compile(spec: JobSpec, caps: Capabilities, ctx: CompileContext = {}): Compiled {
  const rid = recipeIdOf(spec);
  const recipe = rid ? ctx.recipes?.[rid] : null;
  if (rid && !recipe) throw new Error(say("That workflow was deleted. Import it again or pick another engine."));
  switch (spec.kind) {
    case "shot":
      return recipe ? compileRecipeShot(withSectionsOff(spec), recipe) : compileShot(withSectionsOff(spec), caps);
    case "recast":
    case "restyle":
      return compileRecastOrRestyle(spec, caps);
    case "replace":
      return compileReplace(spec, caps);
    case "paths":
      return compilePaths(spec, caps);
    case "workflow":
      return compileWorkflow(spec, recipe!);
    case "image":
      return compileImage(spec, caps);
    case "grade":
      return compileGrade(spec, caps);
  }
}

/** Why a job cannot run on this server, or null when it can. */
export function blocker(spec: JobSpec, caps: Capabilities, ctx: CompileContext = {}): string | null {
  const rid = recipeIdOf(spec);
  if (rid) {
    const r = ctx.recipes?.[rid];
    if (!r) return say("That workflow was deleted. Import it again or pick another engine.");
    const blocking = blockingMissing(r.missing);
    if (!blocking.length) return null;
    return blocking.length === 1
      ? say("This workflow needs a node type the server doesn't have yet. Open it on the Workflows page to install the pack that provides it.")
      : say("This workflow needs {n} node types the server doesn't have yet. Open it on the Workflows page to install the packs that provide them.", { n: blocking.length });
  }
  switch (spec.kind) {
    case "shot":
      return caps.h3 ? null : say("MiniMax H3 is not installed on the server.");
    case "recast":
    case "restyle":
      return caps.h3Ref ? null : say("MiniMax H3 reference-to-video is not installed on the server.");
    case "replace":
      if (!caps.vace) return say("Wan 2.1 VACE is not installed on the server.");
      return caps.pack.boxTrack ? null : say("Replace needs the NovaField nodes (NovaBoxTrackMask). Install the pack to unlock it.");
    case "paths":
      return caps.wanMove ? null : say("WanMove with Wan 2.1 I2V is not installed on the server.");
    case "image":
      return imageBlocker(spec, caps);
    case "grade":
      return gradeBlocker(spec, caps);
    default:
      return null;
  }
}

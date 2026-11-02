import { blockingMissing } from "../workflows/missing";
import type { Recipe } from "../workflows/types";
import { compileRecipeHenshin, compileRecipeShot, compileWorkflow } from "../workflows/compile";
import type { Capabilities } from "./capabilities";
import { compileRecastOrRestyle, compileReplaceH3, compileShot, type Compiled } from "./h3";
import { henshinModel, henshinReady, isHenshin, workflowFits } from "./henshinModels";
import { compileGrade, gradeBlocker } from "./grade";
import { compileImage, imageBlocker } from "./image";
import { withSectionsOff, type JobSpec } from "./specs";
import { compilePaths, compileRecastScail, compileReplace, compileRestyleVace } from "./wan";
import { say } from "@/lib/say";

export type { Compiled };

/** Imported workflows the compiler may need, looked up by id (loaded by the caller). */
export interface CompileContext {
  recipes?: Record<string, Recipe | null | undefined>;
}

export const recipeIdOf = (spec: JobSpec) =>
  spec.kind === "workflow" ? spec.recipe : spec.kind === "image" || spec.kind === "grade" ? null : (spec.engine ?? null);

export function compile(spec: JobSpec, caps: Capabilities, ctx: CompileContext = {}): Compiled {
  const rid = recipeIdOf(spec);
  const recipe = rid ? ctx.recipes?.[rid] : null;
  if (rid && !recipe) throw new Error(say("That workflow was deleted. Import it again or pick another engine."));
  if (recipe && isHenshin(spec)) return compileRecipeHenshin(spec, recipe);
  switch (spec.kind) {
    case "shot":
      return recipe ? compileRecipeShot(withSectionsOff(spec), recipe) : compileShot(withSectionsOff(spec), caps);
    case "recast":
      return spec.model === "scail" ? compileRecastScail(spec, caps) : compileRecastOrRestyle(spec, caps);
    case "restyle":
      return spec.model === "vace" ? compileRestyleVace(spec, caps) : compileRecastOrRestyle(spec, caps);
    case "replace":
      return spec.model === "h3-control" ? compileReplaceH3(spec, caps) : compileReplace(spec, caps);
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
    if (isHenshin(spec) && !workflowFits(r, spec.kind))
      return say("This workflow doesn't take what this mode gives it: words and a clip (and a picture, for Recast), or a still, for motion paths.");
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
    case "replace":
    case "paths": {
      const m = henshinModel(spec.kind, spec.model);
      if (henshinReady(spec.kind, m.id, caps)) return null;
      if (spec.kind === "replace" && !caps.pack.boxTrack) return say("Replace needs the NovaField nodes (NovaBoxTrackMask). Install the pack to unlock it.");
      return say("{model} is not installed on the server. It needs: {files}.", { model: m.name, files: m.files.join(", ") });
    }
    case "image":
      return imageBlocker(spec, caps);
    case "grade":
      return gradeBlocker(spec, caps);
    default:
      return null;
  }
}

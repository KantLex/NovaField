// "Reuse": load a take's prompt, references and settings back into its form, ready to change
// and generate again. Nothing is queued; the user decides when to roll.

import type { Job } from "@/lib/jobs";
import { toast } from "./api";
import { DEFAULT_SHOT, useLive, useStudio } from "./state";
import { useLab } from "./image/state";
import { useForms } from "./workflows/store";

/** Where the reused take's form lives, or null when its kind has no form to fill. */
export function reuseTarget(job: Job): string | null {
  if (job.spec.kind === "shot") return "/";
  if (job.spec.kind === "workflow") return `/workflows?open=${encodeURIComponent(job.spec.recipe)}`;
  if (job.spec.kind === "image") return "/image";
  return null;
}

/** Fills the form from the take and returns the page to show it on. */
export function reuse(job: Job): string | null {
  const spec = job.spec;
  if (spec.kind === "shot") {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kind, seed, extend, ...rest } = spec;
    const { shot, patch } = useStudio.getState();
    patch({
      // Start from defaults so settings the old take didn't have don't leak in from the current draft.
      ...DEFAULT_SHOT,
      ...rest,
      startFrame: rest.startFrame,
      endFrame: rest.endFrame,
      off: rest.off,
      takes: shot.takes,
      // A fresh seed, so generating again gives a new variation rather than the same take.
      lockSeed: null,
      extendFrom: extend && useLive.getState().jobs[extend.fromJob] ? extend.fromJob : null,
    });
    useLive.getState().setFocus(null);
    focusPrompt();
  } else if (spec.kind === "workflow") {
    useForms.setState((s) => ({ values: { ...s.values, [spec.recipe]: { ...spec.values } } }));
  } else if (spec.kind === "image") {
    // The same tool and settings, on the picture it was made from.
    const text = { [spec.tool === "edit" ? "edit" : spec.tool === "upscale" ? "detail" : "fill"]: spec.prompt };
    useLab.getState().set({ tool: spec.tool, ...text, ...(spec.model ? { model: spec.model } : {}), ...(spec.scale ? { scale: spec.scale } : {}), ...(spec.creativity !== undefined ? { creativity: spec.creativity } : {}), ...(spec.aspect ? { aspect: spec.aspect } : {}), asset: spec.from ? useLab.getState().asset : spec.image });
    useLive.getState().setFocus(spec.from && useLive.getState().jobs[spec.from] ? spec.from : null);
  } else return null;
  toast("Prompt and references loaded. Change anything, then generate.", "done");
  return reuseTarget(job);
}

const FOCUS_EVENT = "nf:focus-prompt";
let pendingFocus = false;

/** Puts the cursor in the Studio's script field, now or once the Studio has mounted. */
export function focusPrompt() {
  pendingFocus = true;
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

/** Lets a prompt field take the focus after a reuse, now or once its page has mounted. */
export function onReuseFocus(focus: () => void) {
  const go = () => {
    if (!pendingFocus) return;
    pendingFocus = false;
    focus();
  };
  go();
  window.addEventListener(FOCUS_EVENT, go);
  return () => window.removeEventListener(FOCUS_EVENT, go);
}

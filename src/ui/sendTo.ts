"use client";

// Sending a take onward: its picture to a frame slot, the cast or Henshin; its clip to Henshin,
// the previs slot or the edit. Each step says where it went and what to do next.

import { previsSeconds } from "@/lib/engines/sizing";
import type { Asset } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { api, fail, toast } from "./api";
import { useG } from "./henshin/state";
import { openAssetInLab } from "./image/state";
import { focusPrompt } from "./reuse";
import { appendToEdit } from "./sequence";
import { useLive, useStudio } from "./state";
import { useRecipes } from "./workflows/store";
import { tr } from "@/i18n";

export type PictureTarget = "first" | "last" | "cast" | "paths" | "style" | "lab";
export type ClipTarget = "restyle" | "recast" | "replace" | "previs";

/** Where a picture can go, in the order the "Use as" menus list them. */
export const PICTURE_TARGETS: { id: PictureTarget; label: string }[] = [
  { id: "first", label: "First frame of the next shot" },
  { id: "last", label: "Last frame of the next shot" },
  { id: "cast", label: "Cast member" },
  { id: "paths", label: "Still for motion paths" },
  { id: "style", label: "Style image for Restyle" },
  { id: "lab", label: "Picture to edit or upscale" },
];

/** Moves the browser to a page unless it's already there. */
export type Go = (href: string) => void;
/** Shows the page the take went to, with its form rather than a take on the monitor. */
function goTo(go: Go, href: string) {
  useLive.getState().setFocus(null);
  if (window.location.pathname !== href) go(href);
}

const handle = (label?: string) => label?.replace(/\s+/g, "").slice(0, 16);

/** The Studio's model makes stills: switch to MiniMax H3 so a first frame turns into motion. Returns whether it switched. */
function ensureVideoEngine() {
  const { shot, patch } = useStudio.getState();
  const output = shot.engine ? useRecipes.getState().list.find((r) => r.id === shot.engine)?.output : undefined;
  if (output !== "image") return false;
  patch({ engine: undefined });
  return true;
}

/** Puts a picture where it's used next. */
export function sendPicture(asset: Asset, to: PictureTarget, go: Go) {
  const { shot, patch, addCast } = useStudio.getState();
  switch (to) {
    case "first":
      patch({ startFrame: asset, extendFrom: null });
      toast(
        ensureVideoEngine()
          ? "Set as the first frame, and the model is now MiniMax H3 so it moves. Write what happens, then press Create."
          : "Set as the first frame. Write what happens, then press Create.",
        "done",
      );
      focusPrompt();
      return goTo(go, "/");
    case "last":
      patch({ endFrame: asset });
      toast("Set as the last frame of the next shot.", "done");
      return goTo(go, "/");
    case "cast": {
      if (shot.cast.length >= 9) return toast("The cast is full (9). Remove someone first.", "error");
      const name = handle(asset.label) || `cast${shot.cast.length + 1}`;
      addCast({ ...asset, label: name });
      toast(tr("Added to the cast as @{name}. Mention @{name} in the script.", { name }), "done");
      return goTo(go, "/");
    }
    case "paths":
      useG.getState().set({ mode: "paths", still: asset, paths: [], pathTiming: [] });
      toast("Draw where things should move, then press Animate.", "done");
      return goTo(go, "/henshin");
    case "style": {
      const g = useG.getState();
      g.set({ mode: "restyle", styleRef: asset });
      toast(g.h3Source ? "Set as the style image. Press Restyle when ready." : "Set as the style image. Now drop the clip to restyle.", "done");
      return goTo(go, "/henshin");
    }
    case "lab":
      return openAssetInLab(asset, go);
  }
}

/** An image take's picture, or a video take's frame (`at` seconds in, or the last), sent onward. */
export async function sendTakePicture(job: Job, to: PictureTarget, go: Go, at?: number) {
  try {
    sendPicture(job.video ? await api.frame(job.id, at) : await api.useTake(job.id, "image"), to, go);
  } catch (e) {
    fail(e);
  }
}

/** Puts a video take into a Henshin mode or the previs slot. */
export async function sendClip(job: Job, to: ClipTarget, go: Go) {
  try {
    switch (to) {
      case "restyle":
      case "recast": {
        const h3Source = { ...(await api.useTake(job.id, "h3")), label: job.title };
        useG.getState().set({ mode: to, h3Source });
        toast(to === "restyle" ? "Clip loaded into Restyle. Describe the new look, then press Restyle." : "Clip loaded into Recast. Pick the character, then press Recast.", "done");
        return goTo(go, "/henshin");
      }
      case "replace": {
        const wanSource = { ...(await api.useTake(job.id, "wan")), label: job.title };
        useG.getState().set({ mode: "replace", wanSource, keys: [] });
        toast("Clip loaded into Replace. Draw a box around the thing to swap.", "done");
        return goTo(go, "/henshin");
      }
      case "previs": {
        const clip = await api.useTake(job.id, "h3");
        const { shot, patch } = useStudio.getState();
        patch({ previs: { clip: { ...clip, label: job.title }, follow: shot.previs?.follow ?? "camera" }, duration: previsSeconds(clip) });
        toast(
          useStudio.getState().shot.engine
            ? "Set as the previs. Pick MiniMax H3 (built in) as the model to use it."
            : "Set as the previs: the next shot follows this camera move.",
          "done",
        );
        return goTo(go, "/");
      }
    }
  } catch (e) {
    fail(e);
  }
}

/** Adds a video take to the end of the current project's edit. */
export function sendToEdit(job: Job) {
  appendToEdit(job).then(() => toast("Added to the end of the edit.", "done"), fail);
}

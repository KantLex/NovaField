// Finishing a clip: optional shutter blur and speed change, colour continuity with another shot,
// then NovaLensFilm's look, back into a video at the clip's frame rate (with its sound, unless the
// speed changed). No generative model runs, so it's quick and costs nothing.

import { Graph, type Link } from "../comfy/graph";
import { hasColour, isIdentity } from "../cinema/grade";
import { filmSupport, MODELS, type Capabilities } from "./capabilities";
import { lensFilm, type Compiled } from "./h3";
import type { FilmLab, GradeMotion, GradeSpec } from "./specs";
import { say } from "@/lib/say";

/** Whether the motion settings change anything. */
export const motionOn = (m?: GradeMotion | null): m is GradeMotion => !!m && (m.shutter > 0 || Math.abs(m.speed - 1) > 1e-3);

/** Whether a grade changes the clip at all. */
export const gradeChanges = (spec: Pick<GradeSpec, "film" | "match" | "motion">) => !isIdentity(spec.film) || !!spec.match || motionOn(spec.motion);

/** Frames a clip has after a speed change (NovaShutter's output_frames). */
export const framesAtSpeed = (frames: number, speed: number) => Math.max(1, Math.floor((frames - 1) / Math.max(speed, 1e-3) + 1e-6) + 1);

/**
 * How many in-between frames to make for the shutter: enough for a smooth blur (and for every
 * slow-motion frame), but no more than about 6 GB of frames in memory.
 */
export function interpolationFor(spec: Pick<GradeSpec, "source" | "motion">): number {
  const m = spec.motion;
  if (!motionOn(m)) return 1;
  // A closed shutter at normal or higher speed only drops frames: nothing to interpolate.
  if (m.shutter <= 0 && m.speed >= 1) return 1;
  const s = spec.source;
  const frameBytes = (s.width || 1280) * (s.height || 720) * 3 * 4;
  const frames = s.frames || Math.round((s.duration || 5) * (s.fps || 24));
  const budget = Math.floor(6e9 / Math.max(1, frames * frameBytes));
  const wanted = Math.max(m.shutter > 0 ? 6 : 1, m.speed < 1 ? Math.ceil(1 / m.speed) : 1);
  return Math.max(2, Math.min(8, wanted, budget));
}

export function gradeBlocker(spec: GradeSpec, caps: Capabilities): string | null {
  if (!caps.pack.lensFilm) return say("Grading needs the NovaField nodes (NovaLensFilm). Install the pack to unlock it.");
  if (spec.source.kind !== "video") return say("Pick a clip to grade.");
  if (!gradeChanges(spec)) return say("Pick a look or turn up an effect: this grade changes nothing.");
  if (spec.match && !caps.pack.matchColor) return say("Matching another shot needs NovaField nodes 0.4.0 on the server. Update the NovaField pack in ComfyUI Manager, then restart ComfyUI.");
  if (motionOn(spec.motion)) {
    if (!caps.pack.shutter) return say("Motion blur and speed need NovaField nodes 0.4.0 on the server. Update the NovaField pack in ComfyUI Manager, then restart ComfyUI.");
    if (interpolationFor(spec) > 1 && !caps.interpolate) return say("Motion blur and slow motion need FILM frame interpolation (film_net_fp16) on the server.");
  }
  return isIdentity(spec.film) ? null : filmBlocker(spec.film, caps);
}

/**
 * Why the server's NovaLensFilm can't run this grade as it is: a newer stock, or the colour controls
 * and grain size, need NovaField nodes 0.3.0. Null when it can.
 */
export function filmBlocker(film: FilmLab, caps: Capabilities): string | null {
  const support = filmSupport(caps);
  if (!support.looks.includes(film.look)) return say("This film stock needs NovaField nodes 0.3.0 on the server. Update the NovaField pack in ComfyUI Manager, then restart ComfyUI.");
  if (!support.controls && (hasColour(film) || (film.grainSize ?? 1) !== 1))
    return say("The colour controls and grain size need NovaField nodes 0.3.0 on the server. Update the NovaField pack in ComfyUI Manager, or set them back to neutral.");
  return null;
}

export function compileGrade(spec: GradeSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const notes: string[] = [];
  const video = g.add("LoadVideo", { file: spec.source.name }, "Clip");
  const parts = g.add("GetVideoComponents", { video: video.out() }, "Frames and sound");
  let images: Link = parts.out(0);
  const fps = spec.source.fps || 24;
  let frames = spec.source.frames ?? Math.round((spec.source.duration ?? 0) * fps);
  const motion = motionOn(spec.motion) ? spec.motion : null;
  if (motion) {
    const m = interpolationFor(spec);
    if (m > 1) {
      const model = g.add("FrameInterpolationModelLoader", { model_name: MODELS.film });
      images = g.add("FrameInterpolate", { interp_model: model.out(), images, multiplier: m }, "In-between frames").out();
    }
    images = g.add("NovaShutter", { images, multiplier: m, shutter_angle: motion.shutter, speed: motion.speed }, "Shutter").out();
    frames = framesAtSpeed(frames, motion.speed);
  }
  if (spec.match) {
    const reference = g.add("LoadImage", { image: spec.match.reference.name }, "Shot to match").out(0);
    images = g.add("NovaMatchColor", { images, reference, amount: spec.match.amount, colour_only: spec.match.colourOnly }, "Continuity").out();
  }
  const graded = !isIdentity(spec.film);
  if (graded) images = lensFilm(g, images, spec.film, spec.seed, filmSupport(caps).controls);
  // A speed change would put the sound out of step, so it's left out.
  const keepSound = !motion || Math.abs(motion.speed - 1) < 1e-3;
  if (!keepSound) notes.push("The sound is left out: it can't follow a speed change.");
  const out = g.add("CreateVideo", { images, fps: parts.out(2), ...(keepSound ? { audio: parts.out(1) } : {}) }, "Clip");
  g.add("SaveVideo", { video: out.out(), filename_prefix: "novafield/grade", format: "auto", "format.codec": "auto", codec: "auto" }, "Save");
  return {
    graph: g.toJSON(),
    meta: {
      // The pack's nodes that ran, in order.
      engine: [motion && "NovaShutter", spec.match && "NovaMatchColor", graded && "NovaLensFilm"].filter(Boolean).join(" + ") || "NovaLensFilm",
      prompt: spec.film.look,
      width: spec.source.width ?? 0,
      height: spec.source.height ?? 0,
      frames,
      fps,
      seconds: frames / fps,
      trimHead: 0,
      output: "video",
      notes,
    },
  };
}

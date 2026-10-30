// MiniMax H3 graphs: shots (text / first-last frame / references / ghost-rig camera / extend)
// and the H3 half of Henshin (recast, restyle).

import { Graph, type Link, type NodeRef } from "../comfy/graph";
import { isStill, shotPath } from "../cinema/custom";
import type { Capabilities } from "./capabilities";
import { filmSupport, MODELS } from "./capabilities";
import { composeShotPrompt, resolveMentions } from "./prompt";
import { H3_FPS, h3FramesAtMost, nearestAspect, planH3, QUALITY, sizeFor } from "./sizing";
import type { FilmLab, RecastSpec, RestyleSpec, ShotSpec } from "./specs";
import { say } from "@/lib/say";

/** The note when a moving shot goes out without its previs (the ghost rig); the prompt bar offers to turn it on. */
export const NEWER_STOCK_NOTE = "This film stock needs NovaField nodes 0.3.0 on the server; until they're updated it is only described in the prompt.";
export const RIG_OFF_NOTE = "Previs is off, so the camera move is only described in words and H3 may not follow it.";

export interface Compiled {
  graph: ReturnType<Graph["toJSON"]>;
  meta: {
    engine: string;
    prompt: string;
    width: number;
    height: number;
    frames: number;
    fps: number;
    seconds: number;
    /** Frames at the head that repeat the previous take (extend); dropped when assembling. */
    trimHead: number;
    /** What the take is: a clip, a still or sound. Missing on takes from before it was recorded. */
    output?: "video" | "image" | "audio";
    notes: string[];
    cameraPath?: unknown;
    /** The previs clip the take followed, to compare against (browser URL). */
    previs?: string;
  };
}

interface Core {
  model: Link;
  scheduleModel: Link;
  clip: Link;
  vae: Link;
  audioVae: Link;
  steps: number;
}

function h3Core(g: Graph, ref: boolean, turbo: boolean): Core {
  const unet = g.add("UNETLoader", { unet_name: ref ? MODELS.h3Ref2v : MODELS.h3Fl2v, weight_dtype: "default" }, "H3 model");
  let model = unet.out();
  if (turbo) {
    model = g
      .add("LoraLoaderModelOnly", { model, lora_name: ref ? MODELS.h3Ref2vTurbo : MODELS.h3Fl2vTurbo, strength_model: 1 }, "Turbo 8-step")
      .out();
  }
  const clip = g.add("CLIPLoader", { clip_name: MODELS.h3Clip, type: "minimax", device: "default" }).out();
  const vae = g.add("VAELoader", { vae_name: MODELS.h3Vae }).out();
  const audioVae = g.add("VAELoader", { vae_name: MODELS.h3AudioVae }).out();
  return { model, scheduleModel: unet.out(), clip, vae, audioVae, steps: turbo ? 8 : 20 };
}

function sample(g: Graph, core: Core, positive: Link, latent: Link, seed: number): Link {
  const noise = g.add("RandomNoise", { noise_seed: seed });
  const sampler = g.add("KSamplerSelect", { sampler_name: "res_multistep" });
  const sigmas = g.add("BasicScheduler", { model: core.scheduleModel, scheduler: "simple", steps: core.steps, denoise: 1 });
  const guider = g.add("BasicGuider", { model: core.model, conditioning: positive });
  return g.add(
    "SamplerCustomAdvanced",
    { noise: noise.out(), guider: guider.out(), sampler: sampler.out(), sigmas: sigmas.out(), latent_image: latent },
    "Sampling",
  ).out();
}

function finish(
  g: Graph,
  core: Core,
  latent: Link,
  o: { tiled: boolean; film?: FilmLab; filmControls?: boolean; smooth: boolean; audio: Link | null; seed: number; prefix: string },
): number {
  let images: Link = o.tiled
    ? g.add("VAEDecodeTiled", { samples: latent, vae: core.vae, tile_size: 512, overlap: 64, temporal_size: 32, temporal_overlap: 8 }, "Developing").out()
    : g.add("VAEDecode", { samples: latent, vae: core.vae }, "Developing").out();
  if (o.film) images = lensFilm(g, images, o.film, o.seed, o.filmControls);
  let fps = H3_FPS;
  if (o.smooth) {
    const interp = g.add("FrameInterpolationModelLoader", { model_name: MODELS.film });
    images = g.add("FrameInterpolate", { interp_model: interp.out(), images, multiplier: 2 }, "Smoothing motion").out();
    fps = H3_FPS * 2;
  }
  const video = g.add("CreateVideo", {
    images,
    fps,
    bit_depth: 8,
    color_space: "sRGB",
    codec: "none",
    ...(o.audio ? { audio: o.audio } : {}),
  });
  save(g, video, o.prefix);
  return fps;
}

/** The film lab on a frame batch. `controls`: the server's node has the 0.3.0 colour controls and grain size. */
export function lensFilm(g: Graph, images: Link, f: FilmLab, seed: number, controls = false): Link {
  return g
    .add(
      "NovaLensFilm",
      {
        images,
        look: f.look,
        intensity: f.intensity,
        grain: f.grain,
        halation: f.halation,
        vignette: f.vignette,
        chromatic: f.chromatic,
        gate_weave: f.gateWeave,
        anamorphic_streak: f.streak,
        seed: seed % 2 ** 31,
        ...(controls
          ? {
              exposure: f.exposure ?? 0,
              contrast: f.contrast ?? 0,
              saturation: f.saturation ?? 0,
              temperature: f.temperature ?? 0,
              tint: f.tint ?? 0,
              fade: f.fade ?? 0,
              grain_size: f.grainSize ?? 1,
            }
          : {}),
      },
      "Film lab",
    )
    .out();
}

export function save(g: Graph, video: NodeRef, prefix: string) {
  g.add("SaveVideo", { video: video.out(), filename_prefix: prefix, format: "auto", "format.codec": "auto", codec: "auto" }, "Save");
}

const loadImage = (g: Graph, name: string, title?: string) => g.add("LoadImage", { image: name }, title).out();

export function compileShot(spec: ShotSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const notes: string[] = [];
  const plan = planH3(spec.aspect, spec.quality, spec.duration);
  if (plan.clamped) notes.push(say("Shortened to {seconds} s: H3 breaks down past this length at {size}.", { seconds: plan.seconds.toFixed(1), size: `${plan.width}×${plan.height}` }));

  const cameraPath = shotPath({
    move: spec.move,
    combo: spec.combo,
    size: spec.size,
    angle: spec.angle,
    lens: spec.lens,
    intensity: spec.intensity,
    rig: spec.rig,
    timing: spec.timing,
    shake: spec.shake,
    frames: plan.frames,
    fps: H3_FPS,
  });
  // A previs clip drives the camera in place of the preset move and its ghost rig.
  const previs = spec.off?.move ? null : (spec.previs ?? null);
  const useRig = !previs && spec.cameraMode === "rig" && caps.pack.ghostRig && !isStill(cameraPath);
  if (!previs && spec.cameraMode === "rig" && !caps.pack.ghostRig) notes.push("Previs needs the NovaField nodes; the camera move went into the prompt instead.");
  // A move told only in words is a suggestion H3 often reinterprets (a spiral can come out as a barrel roll).
  if (!previs && spec.cameraMode !== "rig" && caps.pack.ghostRig && !isStill(cameraPath)) notes.push(RIG_OFF_NOTE);
  if (previs && (previs.clip.duration ?? 2) < 2) notes.push("The previs clip is shorter than 2 s; H3 needs at least 2 s of reference video.");
  const ref = spec.cast.length > 0 || useRig || !!previs;
  const turbo = spec.turbo && (ref ? caps.h3RefTurbo : caps.h3Turbo);
  const core = h3Core(g, ref, turbo);

  const prompt = composeShotPrompt(spec, {
    rigVideoIndex: useRig ? 1 : undefined,
    previs: previs ? { index: 1, follow: previs.follow } : undefined,
    startFrame: !!spec.startFrame,
    path: cameraPath,
  });
  const start = spec.startFrame ? loadImage(g, spec.startFrame.name, "First frame") : undefined;
  const end = spec.endFrame ? loadImage(g, spec.endFrame.name, "Last frame") : undefined;

  let positive: Link;
  let latent: Link;
  if (ref) {
    const inputs: Record<string, Link | string | number> = {
      clip: core.clip,
      prompt,
      width: plan.width,
      height: plan.height,
      length: plan.frames,
      ref_image_size: "match",
      vae: core.vae,
      audio_vae: core.audioVae,
    };
    spec.cast.slice(0, 9).forEach((c, i) => (inputs[`ref_images.ref_image_${i}`] = loadImage(g, c.name, c.label ?? `Cast ${i + 1}`)));
    if (useRig) {
      const rig = g.add(
        "NovaGhostRig",
        {
          camera_path: JSON.stringify(cameraPath),
          width: Math.round(plan.width / 2 / 8) * 8,
          height: Math.round(plan.height / 2 / 8) * 8,
          style: spec.rigStyle === "parallax" && !start ? "subject" : spec.rigStyle,
          line_strength: 1,
          ...(spec.rigStyle === "parallax" && start ? { image: start } : {}),
        },
        "Previs",
      );
      inputs["ref_videos.ref_video_0"] = rig.out(0);
    }
    if (previs) {
      const clip = g.add("LoadVideo", { file: previs.clip.name }, "Previs clip");
      inputs["ref_videos.ref_video_0"] = g.add("GetVideoComponents", { video: clip.out() }).out(0);
    }
    const cond = g.add("MiniMaxH3ReferenceToVideo", inputs, "Script + references");
    positive = cond.out(0);
    latent = cond.out(1);
    if (start) positive = g.add("MiniMaxH3AddGuide", { positive, latent, frame_idx: 0, vae: core.vae, image: start }, "Anchor first frame").out();
    if (end) positive = g.add("MiniMaxH3AddGuide", { positive, latent, frame_idx: -1, vae: core.vae, image: end }, "Anchor last frame").out();
  } else {
    const cond = g.add(
      "MiniMaxH3ImageToVideo",
      { clip: core.clip, vae: core.vae, prompt, width: plan.width, height: plan.height, length: plan.frames, first_frame: start, last_frame: end },
      "Script",
    );
    positive = cond.out(0);
    latent = cond.out(1);
  }

  let trimHead = 0;
  if (spec.extend?.tail) {
    const clip = g.add("LoadVideo", { file: spec.extend.tail.name }, "Previous take tail");
    const parts = g.add("GetVideoComponents", { video: clip.out() });
    positive = g.add(
      "MiniMaxH3AddGuide",
      { positive, latent, frame_idx: 0, vae: core.vae, audio_vae: core.audioVae, image: parts.out(0), audio: parts.out(1) },
      "Continue from previous take",
    ).out();
    trimHead = spec.extend.overlapFrames;
  }

  const sampled = sample(g, core, positive, latent, spec.seed);
  const audio = spec.sound ? g.add("VAEDecodeAudio", { samples: sampled, vae: core.audioVae }, "Sound").out() : null;
  const film = filmSupport(caps);
  const filmOn = spec.filmOnGpu && caps.pack.lensFilm && spec.film.look !== "none" && film.looks.includes(spec.film.look);
  if (spec.filmOnGpu && !caps.pack.lensFilm) notes.push("Film lab needs the NovaField nodes; the stock is only described in the prompt.");
  else if (spec.filmOnGpu && spec.film.look !== "none" && !filmOn) notes.push(NEWER_STOCK_NOTE);
  const smooth = spec.smooth && caps.interpolate;
  const fps = finish(g, core, sampled, {
    tiled: plan.tiled,
    film: filmOn ? spec.film : undefined,
    filmControls: film.controls,
    smooth,
    audio,
    seed: spec.seed,
    prefix: "novafield/shot",
  });

  return {
    graph: g.toJSON(),
    meta: {
      engine: `MiniMax H3 ${ref ? "reference" : spec.startFrame || spec.endFrame ? "image" : "text"}-to-video${turbo ? " Turbo" : ""}${useRig ? ` + previs${spec.rig ? " (custom)" : ""}` : ""}${previs ? " + previs clip" : ""}`,
      prompt,
      width: plan.width,
      height: plan.height,
      // Doubling N frames puts one new frame between each pair: 2N - 1.
      frames: smooth ? plan.frames * 2 - 1 : plan.frames,
      fps,
      seconds: plan.seconds,
      trimHead: trimHead * (smooth ? 2 : 1),
      output: "video",
      notes,
      // The planned move only describes the take when it drove it.
      ...(previs ? { previs: previs.clip.url } : { cameraPath }),
    },
  };
}

function henshinPlan(source: RecastSpec["source"], quality: RecastSpec["quality"]) {
  const aspect = nearestAspect(source.width ?? 16, source.height ?? 9);
  const mp = Math.min(QUALITY[quality].megapixels, QUALITY.studio.megapixels);
  const { width, height } = sizeFor(aspect, mp, 32);
  const frames = h3FramesAtMost(Math.min(source.frames ?? Math.round((source.duration ?? 5) * H3_FPS), 15 * H3_FPS));
  return { width, height, frames };
}

export function compileRecastOrRestyle(spec: RecastSpec | RestyleSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const notes: string[] = [];
  const turbo = caps.h3RefTurbo;
  const core = h3Core(g, true, turbo);
  const plan = henshinPlan(spec.source, spec.quality);
  if (plan.frames < 48) notes.push("The source is shorter than 2 s; H3 needs at least 2 s of reference video.");

  const src = g.add("LoadVideo", { file: spec.source.name }, "Source clip");
  const parts = g.add("GetVideoComponents", { video: src.out() });

  const inputs: Record<string, Link | string | number> = {
    clip: core.clip,
    width: plan.width,
    height: plan.height,
    length: plan.frames,
    ref_image_size: "match",
    vae: core.vae,
    audio_vae: core.audioVae,
    "ref_videos.ref_video_0": parts.out(0),
  };
  if (spec.audio !== "none") inputs["ref_video_audios.ref_video_audio_0"] = parts.out(1);

  let prompt: string;
  if (spec.kind === "recast") {
    const refs = [spec.character, ...spec.extras].slice(0, 9);
    refs.forEach((r, i) => (inputs[`ref_images.ref_image_${i}`] = loadImage(g, r.name, i === 0 ? "New lead" : `Extra ${i}`)));
    const notesText = resolveMentions(spec.notes.trim(), refs);
    // With no direction, everything but the person is copied. A direction ("make it night") may
    // change the scene too, so the background and light are no longer locked to the source.
    prompt = [
      "<Picture 1> replaces the main person in <Video 1>.",
      notesText
        ? "Copy <Video 1>'s body motion, gestures, timing, facial performance, camera movement and framing exactly."
        : "Copy <Video 1> exactly: the same body motion, gestures, timing, facial performance, camera movement, framing and background.",
      notesText ? "The person's face, hair, body and outfit come from <Picture 1>." : "Only the person changes: their face, hair, body and outfit come from <Picture 1>.",
      refs.length > 1 ? `Use ${refs.slice(1).map((_, i) => `<Picture ${i + 2}>`).join(", ")} for the other people or props.` : "",
      notesText ? `Direction: ${notesText.replace(/[.\s]+$/, "")}. Follow it even where it changes the lighting, time of day, weather, setting or background of <Video 1>.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  } else {
    if (spec.styleRef) inputs["ref_images.ref_image_0"] = loadImage(g, spec.styleRef.name, "Style reference");
    prompt = [
      `Re-create <Video 1> shot for shot in a new visual style${spec.styleRef ? " taken from <Picture 1>" : ""}: ${spec.style.trim() || "the reference style"}.`,
      "Keep every movement, its timing, the camera path, the composition and the people's performances identical to <Video 1>.",
      "Change only rendering, materials, palette and lighting.",
    ].join(" ");
  }
  inputs.prompt = prompt;

  const cond = g.add("MiniMaxH3ReferenceToVideo", inputs, spec.kind === "recast" ? "Recast" : "Restyle");
  const sampled = sample(g, core, cond.out(0), cond.out(1), spec.seed);
  const audio =
    spec.audio === "original" ? parts.out(1) : spec.audio === "generated" ? g.add("VAEDecodeAudio", { samples: sampled, vae: core.audioVae }).out() : null;
  // A stock the server's node doesn't know yet is left out rather than failing the render.
  const support = filmSupport(caps);
  const film = spec.kind === "restyle" && spec.filmOnGpu && spec.film.look !== "none" && support.looks.includes(spec.film.look) ? spec.film : undefined;
  const fps = finish(g, core, sampled, { tiled: false, film, filmControls: support.controls, smooth: false, audio, seed: spec.seed, prefix: `novafield/${spec.kind}` });

  return {
    graph: g.toJSON(),
    meta: {
      engine: `MiniMax H3 reference-to-video${turbo ? " Turbo" : ""}`,
      prompt,
      width: plan.width,
      height: plan.height,
      frames: plan.frames,
      fps,
      seconds: plan.frames / H3_FPS,
      trimHead: 0,
      output: "video",
      notes,
    },
  };
}

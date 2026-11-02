// Wan 2.1 graphs: object replacement (VACE + a keyframed box track), restyling (VACE following the
// clip's edges), recasting (SCAIL-2) and motion paths (WanMove or ATI).

import { Graph, type Link, type NodeRef } from "../comfy/graph";
import type { Capabilities } from "./capabilities";
import { filmSupport, MODELS } from "./capabilities";
import { lensFilm, save, type Compiled } from "./h3";
import { resolveMentions } from "./prompt";
import { planWan } from "./sizing";
import type { PathPoint, PathsSpec, PathTiming, RecastSpec, ReplaceSpec, RestyleSpec } from "./specs";
import { pathAt, timingOf } from "./tracks";

const WAN_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

/** The usual negative without "style, artwork, painting": a restyle asks for exactly those. */
const RESTYLE_NEGATIVE = WAN_NEGATIVE.replace("风格，作品，画作，画面，", "");

const SILENT_NOTE = "Wan models make no sound of their own; the take is silent.";

function wanCore(g: Graph, unetName: string, caps: Capabilities, loraStrength: number) {
  let model: Link = g.add("UNETLoader", { unet_name: unetName, weight_dtype: "fp8_e4m3fn" }, "Wan model").out();
  const fast = caps.causvid;
  if (fast) model = g.add("LoraLoaderModelOnly", { model, lora_name: MODELS.causvid, strength_model: loraStrength }, "CausVid fast").out();
  model = g.add("ModelSamplingSD3", { model, shift: 8 }).out();
  const clip = g.add("CLIPLoader", { clip_name: MODELS.wanClip, type: "wan", device: "default" }).out();
  const vae = g.add("VAELoader", { vae_name: MODELS.wanVae }).out();
  return { model, clip, vae, steps: fast ? 8 : 30, cfg: fast ? 1 : 5 };
}

export function compileReplace(spec: ReplaceSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const width = spec.source.width ?? 832;
  const height = spec.source.height ?? 480;
  const frames = spec.source.frames ?? 81;
  const core = wanCore(g, MODELS.wanVace, caps, 0.7);

  const src = g.add("LoadVideo", { file: spec.source.name }, "Source clip");
  const parts = g.add("GetVideoComponents", { video: src.out() });
  const track = g.add(
    "NovaBoxTrackMask",
    {
      track: JSON.stringify({ shape: spec.shape, keys: spec.keys }),
      width,
      height,
      frames,
      feather: spec.feather ?? 0.1,
      expand: spec.expand ?? 0.06,
      images: parts.out(0),
    },
    "Box track",
  );
  const positive = g.add("CLIPTextEncode", { clip: core.clip, text: spec.prompt }, "Replacement").out();
  const negative = g.add("CLIPTextEncode", { clip: core.clip, text: WAN_NEGATIVE }).out();
  const vace = g.add(
    "WanVaceToVideo",
    {
      positive,
      negative,
      vae: core.vae,
      width,
      height,
      length: frames,
      batch_size: 1,
      strength: 1,
      control_video: track.out(1),
      control_masks: track.out(0),
      reference_image: spec.replacement ? g.add("LoadImage", { image: spec.replacement.name }, "Replacement image").out() : undefined,
    },
    "VACE inpaint",
  );
  const sampled = g.add(
    "KSampler",
    {
      model: core.model,
      seed: spec.seed,
      steps: core.steps,
      cfg: core.cfg,
      sampler_name: "uni_pc",
      scheduler: "simple",
      positive: vace.out(0),
      negative: vace.out(1),
      latent_image: vace.out(2),
      denoise: 1,
    },
    "Sampling",
  );
  const trimmed = g.add("TrimVideoLatent", { samples: sampled.out(), trim_amount: vace.out(3) });
  const images = g.add("VAEDecode", { samples: trimmed.out(), vae: core.vae }, "Developing");
  const fps = spec.source.fps ?? 16;
  const video = g.add("CreateVideo", { images: images.out(), fps, bit_depth: 8, color_space: "sRGB", codec: "none", audio: parts.out(1) });
  save(g, video, "novafield/replace");

  return {
    graph: g.toJSON(),
    meta: {
      engine: `Wan 2.1 VACE 14B${caps.causvid ? " + CausVid" : ""}`,
      prompt: spec.prompt,
      width,
      height,
      frames,
      fps,
      seconds: frames / fps,
      trimHead: 0,
      output: "video",
      notes: [],
    },
  };
}

/** A path (0–1 coords) as one point per frame, in pixels, following its curve and timing. */
export function resamplePath(points: PathPoint[], n: number, width: number, height: number, timing?: PathTiming) {
  return Array.from({ length: n }, (_, i) => {
    const p = pathAt(points, n === 1 ? 0 : i / (n - 1), timing);
    return { x: Math.round(p.x * width), y: Math.round(p.y * height) };
  });
}

export function compilePaths(spec: PathsSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const ati = spec.model === "ati";
  const { width, height, frames, fps } = planWan(spec.aspect);
  const core = wanCore(g, ati ? MODELS.wanAti : MODELS.wanI2v, caps, 0.6);
  const image = g.add("LoadImage", { image: spec.image.name }, "Start image").out();
  const vision = g.add("CLIPVisionLoader", { clip_name: MODELS.clipVision });
  const visionOut = g.add("CLIPVisionEncode", { clip_vision: vision.out(), image, crop: "none" });
  const tracks = spec.paths.flatMap((p, i) => (p.length ? [resamplePath(p, frames, width, height, timingOf(spec.timing, i))] : []));
  const coords = g.add("PrimitiveStringMultiline", { value: JSON.stringify(tracks) }, "Motion paths");
  const positive = g.add("CLIPTextEncode", { clip: core.clip, text: spec.prompt || "natural, smooth motion" }).out();
  const negative = g.add("CLIPTextEncode", { clip: core.clip, text: WAN_NEGATIVE }).out();
  const shared = { positive, negative, vae: core.vae, width, height, length: frames, batch_size: 1, start_image: image, clip_vision_output: visionOut.out() };
  // ATI reads the same per-frame points straight from the text; WanMove turns them into tracks first.
  const cond = ati
    ? g.add("WanTrackToVideo", { ...shared, tracks: coords.out(), temperature: 220, topk: 10 }, "Motion conditioning")
    : g.add("WanMoveTrackToVideo", { ...shared, strength: 1, tracks: g.add("WanMoveTracksFromCoords", { track_coords: coords.out() }).out(0) }, "Motion conditioning");
  const sampled = g.add(
    "KSampler",
    {
      model: core.model,
      seed: spec.seed,
      steps: core.steps,
      cfg: core.cfg,
      sampler_name: "uni_pc",
      scheduler: "simple",
      positive: cond.out(0),
      negative: cond.out(1),
      latent_image: cond.out(2),
      denoise: 1,
    },
    "Sampling",
  );
  const images = g.add("VAEDecode", { samples: sampled.out(), vae: core.vae }, "Developing");
  const video = g.add("CreateVideo", { images: images.out(), fps, bit_depth: 8, color_space: "sRGB", codec: "none" });
  save(g, video, "novafield/paths");

  return {
    graph: g.toJSON(),
    meta: {
      engine: `${ati ? "Wan 2.1 ATI 14B" : "Wan 2.1 I2V 14B + WanMove"}${caps.causvid ? " + CausVid" : ""}`,
      prompt: spec.prompt,
      width,
      height,
      frames,
      fps,
      seconds: frames / fps,
      trimHead: 0,
      output: "video",
      notes: [],
    },
  };
}

/** Sample, trim the latent VACE padded, decode: the frames of a VACE take. */
function vaceTake(g: Graph, core: ReturnType<typeof wanCore>, vace: NodeRef, seed: number): Link {
  const sampled = g.add(
    "KSampler",
    {
      model: core.model,
      seed,
      steps: core.steps,
      cfg: core.cfg,
      sampler_name: "uni_pc",
      scheduler: "simple",
      positive: vace.out(0),
      negative: vace.out(1),
      latent_image: vace.out(2),
      denoise: 1,
    },
    "Sampling",
  );
  const trimmed = g.add("TrimVideoLatent", { samples: sampled.out(), trim_amount: vace.out(3) });
  return g.add("VAEDecode", { samples: trimmed.out(), vae: core.vae }, "Developing").out();
}

/**
 * Restyle on Wan 2.1 VACE: the clip's edges (Canny, every frame) are the control video, so shapes,
 * motion and timing hold while the words (and a style picture, if given) set the look.
 */
export function compileRestyleVace(spec: RestyleSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const notes: string[] = [];
  const width = spec.source.width ?? 832;
  const height = spec.source.height ?? 480;
  const frames = spec.source.frames ?? 81;
  const fps = spec.source.fps ?? 16;
  const core = wanCore(g, MODELS.wanVace, caps, 0.7);

  const src = g.add("LoadVideo", { file: spec.source.name }, "Source clip");
  const parts = g.add("GetVideoComponents", { video: src.out() });
  const edges = g.add("Canny", { image: parts.out(0), low_threshold: 0.3, high_threshold: 0.6 }, "Edges to follow");
  const prompt = [
    `${spec.style.trim() || "The style of the reference picture"}.`,
    "The same scene, people, movement, timing and camera as the source, re-rendered in this style: new materials, palette and lighting.",
  ].join(" ");
  const positive = g.add("CLIPTextEncode", { clip: core.clip, text: prompt }, "New style").out();
  const negative = g.add("CLIPTextEncode", { clip: core.clip, text: RESTYLE_NEGATIVE }).out();
  const vace = g.add(
    "WanVaceToVideo",
    {
      positive,
      negative,
      vae: core.vae,
      width,
      height,
      length: frames,
      batch_size: 1,
      strength: 1,
      control_video: edges.out(),
      reference_image: spec.styleRef ? g.add("LoadImage", { image: spec.styleRef.name }, "Style reference").out() : undefined,
    },
    "VACE restyle",
  );
  let images = vaceTake(g, core, vace, spec.seed);
  const support = filmSupport(caps);
  if (spec.filmOnGpu && spec.film.look !== "none" && support.looks.includes(spec.film.look)) images = lensFilm(g, images, spec.film, spec.seed, support.controls);
  if (spec.audio === "generated") notes.push(SILENT_NOTE);
  const audio = spec.audio === "original" ? { audio: parts.out(1) } : {};
  const video = g.add("CreateVideo", { images, fps, bit_depth: 8, color_space: "sRGB", codec: "none", ...audio });
  save(g, video, "novafield/restyle");

  return {
    graph: g.toJSON(),
    meta: { engine: `Wan 2.1 VACE 14B${caps.causvid ? " + CausVid" : ""}`, prompt, width, height, frames, fps, seconds: frames / fps, trimHead: 0, output: "video", notes },
  };
}

/**
 * Recast on SCAIL-2: SAM3 finds the people in the clip and in the picture, SCAIL-2 swaps the
 * biggest person for the character, following their pose frame by frame. One 81-frame chunk.
 */
export function compileRecastScail(spec: RecastSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const notes: string[] = [];
  // SCAIL-2 works in steps of 32: the Wan clip is cut down to fit.
  const width = Math.floor((spec.source.width ?? 832) / 32) * 32;
  const height = Math.floor((spec.source.height ?? 480) / 32) * 32;
  const frames = spec.source.frames ?? 81;
  const fps = spec.source.fps ?? 16;
  const fast = caps.scailFast;

  let model: Link = g.add("UNETLoader", { unet_name: MODELS.scail, weight_dtype: "fp8_e4m3fn" }, "SCAIL-2 model").out();
  model = g.add("LoraLoaderModelOnly", { model, lora_name: MODELS.scailDpo, strength_model: 1 }, "SCAIL-2 DPO").out();
  if (fast) model = g.add("LoraLoaderModelOnly", { model, lora_name: MODELS.wanI2vDistill, strength_model: 0.8 }, "Distill fast").out();
  const scheduleModel = model;
  model = g.add("ModelSamplingSD3", { model, shift: 5 }).out();
  const clip = g.add("CLIPLoader", { clip_name: MODELS.wanClip, type: "wan", device: "default" }).out();
  const vae = g.add("VAELoader", { vae_name: MODELS.wanVae }).out();

  const src = g.add("LoadVideo", { file: spec.source.name }, "Source clip");
  const parts = g.add("GetVideoComponents", { video: src.out() });
  const pose = g.add("ImageScale", { image: parts.out(0), upscale_method: "area", width, height, crop: "center" }).out();
  const character = g.add("LoadImage", { image: spec.character.name }, "New lead").out();
  const vision = g.add("CLIPVisionLoader", { clip_name: MODELS.clipVision });
  const visionOut = g.add("CLIPVisionEncode", { clip_vision: vision.out(), image: character, crop: "none" });

  // Who is who: people tracked through the clip and found in the picture, coloured to match.
  const sam = g.add("CheckpointLoaderSimple", { ckpt_name: MODELS.sam3 }, "SAM3");
  const human = () => g.add("CLIPTextEncode", { clip: sam.out(1), text: "human" }).out();
  const inClip = g.add("SAM3_VideoTrack", { images: pose, model: sam.out(0), conditioning: human(), detection_threshold: 0.5, max_objects: 4, detect_interval: 1 }, "People in the clip");
  const inPicture = g.add("SAM3_VideoTrack", { images: character, model: sam.out(0), conditioning: human(), detection_threshold: 0.5, max_objects: 4, detect_interval: 1 }, "Person in the picture");
  const masks = g.add("SCAIL2ColoredMask", { driving_track_data: inClip.out(), ref_track_data: inPicture.out(), object_indices: "0", sort_by: "area", replacement_mode: true });
  if (spec.target) notes.push("SCAIL-2 recasts the biggest person in the clip; picking someone else needs MiniMax H3.");
  if (spec.extras.length) notes.push("SCAIL-2 takes one character picture; the extras are left out.");
  if (spec.audio === "generated") notes.push(SILENT_NOTE);

  const direction = resolveMentions(spec.notes.trim(), [spec.character]).replace(/[.\s]+$/, "");
  const prompt = `The person from the reference picture, moving exactly as in the source clip${direction ? `. ${direction}` : ""}.`;
  const positive = g.add("CLIPTextEncode", { clip, text: prompt }, "Recast").out();
  const negative = g.add("CLIPTextEncode", { clip, text: "" }).out();
  const cond = g.add(
    "WanSCAILToVideo",
    {
      positive,
      negative,
      vae,
      width,
      height,
      length: frames,
      batch_size: 1,
      pose_strength: 1,
      pose_start: 0,
      pose_end: 1,
      video_frame_offset: 0,
      previous_frame_count: 5,
      pose_video: pose,
      pose_video_mask: masks.out(0),
      replacement_mode: true,
      reference_image: character,
      reference_image_mask: masks.out(1),
      clip_vision_output: visionOut.out(),
    },
    "SCAIL-2 recast",
  );
  const steps = fast ? 6 : 40;
  const sampled = g.add(
    "SamplerCustom",
    {
      model,
      add_noise: true,
      noise_seed: spec.seed,
      cfg: fast ? 1 : 5,
      positive: cond.out(0),
      negative: cond.out(1),
      sampler: g.add("KSamplerSelect", { sampler_name: "euler" }).out(),
      sigmas: g.add("BasicScheduler", { model: scheduleModel, scheduler: "simple", steps, denoise: 1 }).out(),
      latent_image: cond.out(2),
    },
    "Sampling",
  );
  const images = g.add("VAEDecode", { samples: sampled.out(1), vae }, "Developing").out();
  const audio = spec.audio === "original" ? { audio: parts.out(1) } : {};
  const video = g.add("CreateVideo", { images, fps, bit_depth: 8, color_space: "sRGB", codec: "none", ...audio });
  save(g, video, "novafield/recast");

  return {
    graph: g.toJSON(),
    meta: { engine: `SCAIL-2 14B${fast ? " + distill" : ""}`, prompt, width, height, frames, fps, seconds: frames / fps, trimHead: 0, output: "video", notes },
  };
}

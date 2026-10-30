// Wan 2.1 graphs: object replacement (VACE + a keyframed box track) and motion paths (WanMove).

import { Graph, type Link } from "../comfy/graph";
import type { Capabilities } from "./capabilities";
import { MODELS } from "./capabilities";
import { save, type Compiled } from "./h3";
import { planWan } from "./sizing";
import type { PathPoint, PathsSpec, PathTiming, ReplaceSpec } from "./specs";
import { pathAt, timingOf } from "./tracks";

const WAN_NEGATIVE =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走";

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
  const { width, height, frames, fps } = planWan(spec.aspect);
  const core = wanCore(g, MODELS.wanI2v, caps, 0.6);
  const image = g.add("LoadImage", { image: spec.image.name }, "Start image").out();
  const vision = g.add("CLIPVisionLoader", { clip_name: MODELS.clipVision });
  const visionOut = g.add("CLIPVisionEncode", { clip_vision: vision.out(), image, crop: "none" });
  const tracks = spec.paths.flatMap((p, i) => (p.length ? [resamplePath(p, frames, width, height, timingOf(spec.timing, i))] : []));
  const coords = g.add("PrimitiveStringMultiline", { value: JSON.stringify(tracks) }, "Motion paths");
  const move = g.add("WanMoveTracksFromCoords", { track_coords: coords.out() });
  const positive = g.add("CLIPTextEncode", { clip: core.clip, text: spec.prompt || "natural, smooth motion" }).out();
  const negative = g.add("CLIPTextEncode", { clip: core.clip, text: WAN_NEGATIVE }).out();
  const cond = g.add(
    "WanMoveTrackToVideo",
    {
      positive,
      negative,
      vae: core.vae,
      strength: 1,
      width,
      height,
      length: frames,
      batch_size: 1,
      start_image: image,
      tracks: move.out(0),
      clip_vision_output: visionOut.out(),
    },
    "Motion conditioning",
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
      engine: `Wan 2.1 I2V 14B + WanMove${caps.causvid ? " + CausVid" : ""}`,
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

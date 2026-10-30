// The picture tools: edit a picture from words (Qwen Image Edit or Flux Kontext), widen its
// frame (the same models, filling a padded border), or upscale it with a light Z Image pass that
// adds real detail instead of only stretching the pixels.

import { Graph, type Link } from "../comfy/graph";
import { MODELS, type Capabilities } from "./capabilities";
import type { Compiled } from "./h3";
import { ASPECTS } from "./sizing";
import type { Asset, ImageModel, ImageSpec } from "./specs";
import { say } from "@/lib/say";

/** Upscaled pictures stay under this many pixels: about 2048×2048, which fits a 24 GB card. */
export const UPSCALE_MAX_PIXELS = 4_200_000;
/** The editing models work at about one megapixel. */
const EDIT_PIXELS = 1_000_000;
const grid = (v: number, step = 16) => Math.max(step, Math.round(v / step) * step);

export const MODEL_LABEL: Record<ImageModel, string> = { qwen: "Qwen Image Edit", kontext: "Flux Kontext" };

/** The editing model a spec runs on: the one asked for if installed, else whichever is. */
export function editModel(spec: Pick<ImageSpec, "model">, caps: Capabilities): ImageModel | null {
  if (spec.model && caps.image[spec.model]) return spec.model;
  return caps.image.qwen ? "qwen" : caps.image.kontext ? "kontext" : null;
}

/** Size of a picture, or a square megapixel when it's unknown. */
const sizeOf = (a: Asset) => ({ w: a.width || 1024, h: a.height || 1024 });

/** How much an upscale can enlarge this picture: as asked (1.5–2), but no bigger than the cap. */
export function upscaleSize(a: Asset, scale = 2): { width: number; height: number; factor: number } {
  const { w, h } = sizeOf(a);
  const factor = Math.min(Math.max(1, scale), Math.sqrt(UPSCALE_MAX_PIXELS / (w * h)));
  return { width: grid(w * factor), height: grid(h * factor), factor };
}

/** The border to add on each side so the picture fills a wider (or taller) frame, centred. */
export function expandPadding(a: Asset, ratio: number): { left: number; right: number; top: number; bottom: number } {
  const { w, h } = sizeOf(a);
  const pad = { left: 0, right: 0, top: 0, bottom: 0 };
  if (w / h < ratio) {
    const extra = Math.round(h * ratio) - w;
    pad.left = grid(extra / 2, 8);
    pad.right = pad.left;
  } else {
    const extra = Math.round(w / ratio) - h;
    pad.top = grid(extra / 2, 8);
    pad.bottom = pad.top;
  }
  // A frame that's already this shape gets nothing (grid() never returns 0, so check the need).
  if (Math.abs(w / h - ratio) / ratio < 0.02) return { left: 0, right: 0, top: 0, bottom: 0 };
  return pad;
}

/** The size the editing models land on for a picture of this shape (about a megapixel). */
function editSize(w: number, h: number) {
  return { width: grid(Math.sqrt(EDIT_PIXELS * (w / h))), height: grid(Math.sqrt(EDIT_PIXELS / (w / h))) };
}

/** Why a picture tool can't run on this server or with this picture, or null when it can. */
export function imageBlocker(spec: ImageSpec, caps: Capabilities): string | null {
  if (spec.tool === "upscale") {
    if (!caps.image.upscale) return say("Upscaling needs Z Image Turbo (z_image_turbo_bf16, qwen_3_4b and ae.safetensors) on the server.");
    return upscaleSize(spec.image, spec.scale).factor < 1.1 ? say("This picture is already as large as NovaField upscales to (about 4 megapixels).") : null;
  }
  if (!editModel(spec, caps)) return say("Editing pictures needs Qwen Image Edit or Flux Kontext on the server.");
  if (spec.tool === "edit" && !spec.prompt.trim()) return say("Say what to change.");
  if (spec.tool === "expand") {
    const ratio = ASPECTS.find((a) => a.id === spec.aspect)?.ratio;
    if (!ratio) return say("Pick the frame to widen to.");
    const p = expandPadding(spec.image, ratio);
    if (!p.left && !p.top) return say("The picture is already that shape.");
  }
  return null;
}

/** The instruction an expand gives the editing model. */
export function expandPrompt(what: string) {
  const fill = what.trim() ? ` In the new space: ${what.trim().replace(/\.$/, "")}.` : "";
  return `Extend the picture outward to fill the flat grey border, continuing the scene naturally with matching light, colour and perspective.${fill} Keep the original part of the picture unchanged and leave no border.`;
}

export function compileImage(spec: ImageSpec, caps: Capabilities): Compiled {
  return spec.tool === "upscale" ? compileUpscale(spec) : compileEdit(spec, caps);
}

function saveImage(g: Graph, images: Link, prefix: string) {
  g.add("SaveImage", { images, filename_prefix: prefix }, "Save");
}

function meta(engine: string, prompt: string, width: number, height: number, notes: string[] = []): Compiled["meta"] {
  return { engine, prompt, width, height, frames: 1, fps: 1, seconds: 0, trimHead: 0, output: "image", notes };
}

function compileEdit(spec: ImageSpec, caps: Capabilities): Compiled {
  const g = new Graph();
  const model = editModel(spec, caps) ?? "qwen";
  const { w, h } = sizeOf(spec.image);
  let picture = g.add("LoadImage", { image: spec.image.name }, "Picture").out();
  let shape = { w, h };
  let prompt = spec.prompt.trim();
  if (spec.tool === "expand") {
    const p = expandPadding(spec.image, ASPECTS.find((a) => a.id === spec.aspect)?.ratio ?? 16 / 9);
    picture = g.add("ImagePadForOutpaint", { image: picture, ...p, feathering: 0 }, "Wider frame").out();
    shape = { w: w + p.left + p.right, h: h + p.top + p.bottom };
    prompt = expandPrompt(prompt);
  }
  const size = editSize(shape.w, shape.h);

  if (model === "qwen") {
    let unet = g.add("UNETLoader", { unet_name: MODELS.qwenEdit, weight_dtype: "default" }, "Qwen Image Edit").out();
    // Qwen Image renders solid black under SageAttention, which many servers switch on for speed.
    if (caps.image.plainAttention) unet = g.add("ModelAttentionBackend", { model: unet, attention: "pytorch attention" }, "Plain attention").out();
    const clip = g.add("CLIPLoader", { clip_name: MODELS.qwenClip, type: "qwen_image", device: "default" }).out();
    const vae = g.add("VAELoader", { vae_name: MODELS.qwenVae }).out();
    const scaled = g.add("ImageScaleToTotalPixels", { image: picture, upscale_method: "lanczos", megapixels: 1, resolution_steps: 16 }).out();
    const positive = g.add("TextEncodeQwenImageEdit", { clip, prompt, vae, image: scaled }, "The change").out();
    const negative = g.add("TextEncodeQwenImageEdit", { clip, prompt: "", vae, image: scaled }).out();
    const latent = g.add("VAEEncode", { pixels: scaled, vae }).out();
    const shifted = g.add("ModelSamplingAuraFlow", { model: unet, shift: 3 }).out();
    const normed = g.add("CFGNorm", { model: shifted, strength: 1 }).out();
    const sampled = g.add(
      "KSampler",
      { model: normed, seed: spec.seed, steps: 20, cfg: 2.5, sampler_name: "euler", scheduler: "simple", positive, negative, latent_image: latent, denoise: 1 },
      "Sampling",
    );
    saveImage(g, g.add("VAEDecode", { samples: sampled.out(), vae }, "Developing").out(), `novafield/${spec.tool}`);
  } else {
    const unet = g.add("UNETLoader", { unet_name: MODELS.kontext, weight_dtype: "default" }, "Flux Kontext").out();
    const clip = g.add("DualCLIPLoader", { clip_name1: MODELS.fluxClipL, clip_name2: MODELS.fluxT5, type: "flux", device: "default" }).out();
    const vae = g.add("VAELoader", { vae_name: MODELS.fluxVae }).out();
    const scaled = g.add("FluxKontextImageScale", { image: picture }).out();
    const latent = g.add("VAEEncode", { pixels: scaled, vae }).out();
    const text = g.add("CLIPTextEncode", { clip, text: prompt }, "The change").out();
    const withRef = g.add("ReferenceLatent", { conditioning: text, latent }).out();
    const positive = g.add("FluxGuidance", { conditioning: withRef, guidance: 2.5 }).out();
    const negative = g.add("ConditioningZeroOut", { conditioning: text }).out();
    const sampled = g.add(
      "KSampler",
      { model: unet, seed: spec.seed, steps: 20, cfg: 1, sampler_name: "euler", scheduler: "simple", positive, negative, latent_image: latent, denoise: 1 },
      "Sampling",
    );
    saveImage(g, g.add("VAEDecode", { samples: sampled.out(), vae }, "Developing").out(), `novafield/${spec.tool}`);
  }
  return { graph: g.toJSON(), meta: meta(MODEL_LABEL[model], prompt, size.width, size.height) };
}

/**
 * Enlarge with a clean resample, then let Z Image Turbo redraw it lightly: low creativity keeps
 * the picture, high lets it invent pores, threads and leaves. Few steps, so it takes seconds.
 */
function compileUpscale(spec: ImageSpec): Compiled {
  const g = new Graph();
  const { width, height, factor } = upscaleSize(spec.image, spec.scale);
  const creativity = Math.min(1, Math.max(0, spec.creativity ?? 0.35));
  const denoise = Math.round((0.15 + 0.4 * creativity) * 100) / 100;
  const picture = g.add("LoadImage", { image: spec.image.name }, "Picture").out();
  const big = g.add("ImageScale", { image: picture, upscale_method: "lanczos", width, height, crop: "disabled" }, "Enlarge").out();
  const unet = g.add("UNETLoader", { unet_name: MODELS.zImage, weight_dtype: "default" }, "Z Image Turbo").out();
  const clip = g.add("CLIPLoader", { clip_name: MODELS.zImageClip, type: "lumina2", device: "default" }).out();
  const vae = g.add("VAELoader", { vae_name: MODELS.fluxVae }).out();
  const model = g.add("ModelSamplingAuraFlow", { model: unet, shift: 3 }).out();
  const text = spec.prompt.trim() || "a sharp, highly detailed photograph";
  const positive = g.add("CLIPTextEncode", { clip, text }, "What it shows").out();
  const negative = g.add("ConditioningZeroOut", { conditioning: positive }).out();
  const latent = g.add("VAEEncode", { pixels: big, vae }).out();
  const sampled = g.add(
    "KSampler",
    { model, seed: spec.seed, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", positive, negative, latent_image: latent, denoise },
    "Adding detail",
  );
  saveImage(g, g.add("VAEDecode", { samples: sampled.out(), vae }, "Developing").out(), "novafield/upscale");
  return { graph: g.toJSON(), meta: meta(`Z Image Turbo upscale ×${factor.toFixed(1)}`, text, width, height) };
}

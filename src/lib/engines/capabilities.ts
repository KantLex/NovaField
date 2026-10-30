// What the connected ComfyUI can do, read from /object_info. Features without their
// nodes or models are shown as locked in the UI instead of failing at render time.

import { enumOptions, type ObjectInfo } from "../comfy/validate";

export const MODELS = {
  h3Fl2v: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  h3Ref2v: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  h3Fl2vTurbo: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
  h3Ref2vTurbo: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors",
  h3Clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  h3Vae: "minimax_h3_video_vae_fp16.safetensors",
  h3AudioVae: "minimax_h3_audio_vae_fp32.safetensors",
  wanVace: "wan2.1_vace_14B_fp16.safetensors",
  wanI2v: "wan2.1_i2v_480p_14B_fp16.safetensors",
  wanClip: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
  wanVae: "wan_2.1_vae.safetensors",
  clipVision: "clip_vision_h.safetensors",
  causvid: "Wan21_CausVid_14B_T2V_lora_rank32.safetensors",
  film: "film_net_fp16.safetensors",
  qwenEdit: "qwen_image_edit_fp8_e4m3fn.safetensors",
  qwenClip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  qwenVae: "qwen_image_vae.safetensors",
  kontext: "flux1-dev-kontext_fp8_scaled.safetensors",
  fluxClipL: "clip_l.safetensors",
  fluxT5: "t5xxl_fp8_e4m3fn_scaled.safetensors",
  fluxVae: "ae.safetensors",
  zImage: "z_image_turbo_bf16.safetensors",
  zImageClip: "qwen_3_4b.safetensors",
} as const;

export interface Capabilities {
  h3: boolean;
  h3Ref: boolean;
  h3Turbo: boolean;
  h3RefTurbo: boolean;
  interpolate: boolean;
  vace: boolean;
  wanMove: boolean;
  causvid: boolean;
  pack: {
    ghostRig: boolean;
    lensFilm: boolean;
    boxTrack: boolean;
    contactSheet: boolean;
    /** The looks the server's NovaLensFilm knows (more since 0.3.0). */
    filmLooks?: string[];
    /** Its colour controls and grain size (0.3.0+). */
    filmControls?: boolean;
    /** Colour continuity, shutter blur and speed, and shot QC (0.4.0+). */
    matchColor?: boolean;
    shutter?: boolean;
    shotQc?: boolean;
  };
  /** The picture tools: editing from words (Qwen Image Edit, Flux Kontext) and upscaling with Z Image. */
  image: { qwen: boolean; kontext: boolean; upscale: boolean; plainAttention: boolean };
}

export const NO_CAPABILITIES: Capabilities = {
  h3: false,
  h3Ref: false,
  h3Turbo: false,
  h3RefTurbo: false,
  interpolate: false,
  vace: false,
  wanMove: false,
  causvid: false,
  pack: { ghostRig: false, lensFilm: false, boxTrack: false, contactSheet: false },
  image: { qwen: false, kontext: false, upscale: false, plainAttention: false },
};

/** NovaLensFilm's looks before 0.3.0, for servers whose node list doesn't say. */
const FILM_LOOKS_0_2 = ["none", "kodak_2383", "fuji_eterna", "bleach_bypass", "teal_orange", "noir", "technicolor", "moonlight", "vhs_1989"];

/** What the server's NovaLensFilm can run: its looks, and whether it has the colour controls and grain size (0.3.0). */
export function filmSupport(caps: Capabilities): { looks: string[]; controls: boolean } {
  if (!caps.pack.lensFilm) return { looks: [], controls: false };
  return { looks: caps.pack.filmLooks?.length ? caps.pack.filmLooks : FILM_LOOKS_0_2, controls: !!caps.pack.filmControls };
}

export function detectCapabilities(info: ObjectInfo): Capabilities {
  const has = (n: string) => n in info;
  const options = (node: string, input: string) => enumOptions(info[node]?.input.required?.[input]) ?? [];
  const unets = options("UNETLoader", "unet_name");
  const loras = options("LoraLoaderModelOnly", "lora_name");
  const clips = options("CLIPLoader", "clip_name");
  const vaes = options("VAELoader", "vae_name");
  const interp = options("FrameInterpolationModelLoader", "model_name");
  const visions = options("CLIPVisionLoader", "clip_name");

  const h3Base = has("MiniMaxH3ImageToVideo") && clips.includes(MODELS.h3Clip) && vaes.includes(MODELS.h3Vae) && vaes.includes(MODELS.h3AudioVae);
  const wanBase = clips.includes(MODELS.wanClip) && vaes.includes(MODELS.wanVae);
  const dualClips = enumOptions(info.DualCLIPLoader?.input.required?.clip_name1) ?? [];
  return {
    h3: h3Base && unets.includes(MODELS.h3Fl2v),
    h3Ref: h3Base && has("MiniMaxH3ReferenceToVideo") && unets.includes(MODELS.h3Ref2v),
    h3Turbo: loras.includes(MODELS.h3Fl2vTurbo),
    h3RefTurbo: loras.includes(MODELS.h3Ref2vTurbo),
    interpolate: has("FrameInterpolate") && interp.includes(MODELS.film),
    vace: wanBase && has("WanVaceToVideo") && unets.includes(MODELS.wanVace),
    wanMove: wanBase && has("WanMoveTrackToVideo") && unets.includes(MODELS.wanI2v) && visions.includes(MODELS.clipVision),
    causvid: loras.includes(MODELS.causvid),
    pack: {
      ghostRig: has("NovaGhostRig"),
      lensFilm: has("NovaLensFilm"),
      boxTrack: has("NovaBoxTrackMask"),
      contactSheet: has("NovaContactSheet"),
      filmLooks: options("NovaLensFilm", "look"),
      filmControls: !!info.NovaLensFilm?.input.optional?.exposure,
      matchColor: has("NovaMatchColor"),
      shutter: has("NovaShutter"),
      shotQc: has("NovaShotQC"),
    },
    image: {
      qwen: has("TextEncodeQwenImageEdit") && has("CFGNorm") && unets.includes(MODELS.qwenEdit) && clips.includes(MODELS.qwenClip) && vaes.includes(MODELS.qwenVae),
      kontext:
        has("ReferenceLatent") && has("FluxKontextImageScale") && unets.includes(MODELS.kontext) && dualClips.includes(MODELS.fluxClipL) && dualClips.includes(MODELS.fluxT5) && vaes.includes(MODELS.fluxVae),
      upscale: has("ModelSamplingAuraFlow") && unets.includes(MODELS.zImage) && clips.includes(MODELS.zImageClip) && vaes.includes(MODELS.fluxVae),
      // Can a model be put back on PyTorch attention (servers started with --use-sage-attention)?
      plainAttention: has("ModelAttentionBackend"),
    },
  };
}

// The models behind NovaField's features, as Settings lists them: what each unlocks and the files
// it loads (a file shared by several is downloaded once).

import { MODELS } from "./engines/capabilities";

export interface ModelSet {
  id: string;
  /** A product name, not translated. */
  name: string;
  /** What it unlocks, shown through tr(). */
  hint: string;
  files: string[];
}

const wan = [MODELS.wanClip, MODELS.wanVae];
const h3 = [MODELS.h3Clip, MODELS.h3Vae, MODELS.h3AudioVae];

export const MODEL_SETS: ModelSet[] = [
  { id: "h3", name: "MiniMax H3", hint: "Studio shots, Continue this shot, Henshin Recast and Restyle", files: [MODELS.h3Fl2v, MODELS.h3Ref2v, ...h3] },
  { id: "h3-turbo", name: "MiniMax H3 Turbo", hint: "Faster H3 takes: 8 steps instead of 20", files: [MODELS.h3Fl2vTurbo, MODELS.h3Ref2vTurbo] },
  { id: "vace", name: "Wan 2.1 VACE", hint: "Henshin Replace, and Restyle on VACE", files: [MODELS.wanVace, ...wan, MODELS.causvid] },
  {
    id: "scail",
    name: "SCAIL-2",
    hint: "Henshin Recast on SCAIL-2",
    files: [MODELS.scail, MODELS.scailDpo, MODELS.sam3, MODELS.clipVision, ...wan, MODELS.wanI2vDistill],
  },
  { id: "h3-control", name: "MiniMax H3 + Fun ControlNet", hint: "Henshin Replace on H3", files: [MODELS.h3FunControl, MODELS.h3Ref2v, ...h3] },
  { id: "wanmove", name: "Wan 2.1 + WanMove", hint: "Henshin Motion paths", files: [MODELS.wanI2v, MODELS.clipVision, ...wan, MODELS.causvid] },
  { id: "ati", name: "Wan 2.1 ATI", hint: "Henshin Motion paths on ATI", files: [MODELS.wanAti, MODELS.clipVision, ...wan] },
  { id: "qwen", name: "Qwen Image Edit", hint: "Image: Edit and Expand", files: [MODELS.qwenEdit, MODELS.qwenClip, MODELS.qwenVae] },
  { id: "kontext", name: "Flux Kontext", hint: "Image: Edit and Expand", files: [MODELS.kontext, MODELS.fluxClipL, MODELS.fluxT5, MODELS.fluxVae] },
  { id: "zimage", name: "Z Image Turbo", hint: "Image: Upscale", files: [MODELS.zImage, MODELS.zImageClip, MODELS.fluxVae] },
  { id: "film", name: "FILM frame interpolation", hint: "48 fps, and Grade's Shutter and Speed", files: [MODELS.film] },
];

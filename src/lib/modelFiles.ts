// The model files NovaField's features load, where each comes from and which ComfyUI folder it
// goes in. One list, kept in the node pack (which downloads them) and read here.

import catalog from "../../comfyui-novafield/nova/model_catalog.json";

export interface ModelFile {
  url: string;
  /** ComfyUI's models folder for it: "diffusion_models", "loras", "vae"… */
  folder: string;
  /** Bytes. */
  size: number;
}

export const MODEL_FILES: Record<string, ModelFile> = catalog.files;

/** What one model's download is doing, as the node pack reports it. */
export interface ModelJob {
  state: "queued" | "downloading" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  error?: string;
}

export interface ModelsStatus {
  /** Comfy Cloud has its own models; nothing to download. */
  cloud: boolean;
  /** The NovaField nodes' version when they can download (0.5.0+), else null. */
  pack: string | null;
  /** Per file in the list: is it on the server, and any download of it. */
  files: Record<string, { installed: boolean; job?: ModelJob }>;
}

/** The files of `names` that NovaField knows how to get. */
export const knownFiles = (names: string[]) => names.filter((n) => n in MODEL_FILES);

export const totalSize = (names: string[]) => knownFiles(names).reduce((s, n) => s + MODEL_FILES[n].size, 0);

import path from "node:path";

// Which ComfyUI to use lives in ./connection (Connection screen, or COMFY_URL in .env.local).
/** Simulate renders locally instead of queueing on the GPU (UI work, demos). */
export const DRY_RUN = process.env.NOVAFIELD_DRY_RUN === "1";
/** Where NovaField keeps its records; NOVAFIELD_DATA points a separate instance (the browser tests) elsewhere. */
export const DATA_DIR = process.env.NOVAFIELD_DATA ? path.resolve(process.env.NOVAFIELD_DATA) : path.join(process.cwd(), "data");
export const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.FFPROBE ?? "ffprobe";

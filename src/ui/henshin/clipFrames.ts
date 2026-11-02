// A clip's frames as small pictures, for the box tracker: seek a hidden video to the middle of
// each frame and read it back through a canvas.

import type { Pic } from "@/lib/engines/autotrack";

/** Every frame of `url` (`frames` long at `fps`), `width` pixels wide, as RGB 0–1. */
export async function clipFrames(url: string, frames: number, fps: number, width = 256, onProgress?: (pct: number) => void): Promise<Pic[]> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error("The clip couldn't be read."));
  });
  const w = width;
  const h = Math.max(2, Math.round((width * v.videoHeight) / Math.max(1, v.videoWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const out: Pic[] = [];
  try {
    for (let f = 0; f < frames; f++) {
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = (f + 0.5) / fps;
      });
      ctx.drawImage(v, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      const data = new Float32Array(w * h * 3);
      for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = px[i * 4 + c] / 255;
      out.push({ w, h, data });
      onProgress?.((f + 1) / frames);
    }
  } finally {
    v.removeAttribute("src");
    v.load();
  }
  return out;
}

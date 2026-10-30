"use client";

import { labStats, type LabStats } from "@/lib/cinema/match";

const cache = new Map<string, Promise<LabStats>>();

/** CIELAB mean and spread of a picture (a poster, a filmstrip, a frame), measured small in the browser. */
export function labOf(url: string): Promise<LabStats> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise<LabStats>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const scale = Math.min(1, 192 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("No 2D canvas"));
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(labStats(ctx.getImageData(0, 0, c.width, c.height).data));
      };
      img.onerror = () => reject(new Error(`Couldn't load ${url}`));
      img.src = url;
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

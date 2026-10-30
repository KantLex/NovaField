"use client";

import type { CameraPath } from "@/lib/cinema/camera";
import { readoutAt } from "@/lib/cinema/metrics";
import { timecode } from "@/lib/engines/sizing";
import { drawFrame, type RigStyle } from "./rig";

const pickType = () => ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

/**
 * Records the previs as a video file, in real time: the wireframe move with frame lines, a burnt-in
 * timecode and the lens, for sharing a shot before it's rendered.
 */
export async function recordPrevis(path: CameraPath, style: RigStyle, ratio: number, label: string, onProgress?: (pct: number) => void): Promise<Blob> {
  const w = 1280;
  const h = Math.round(w / ratio / 2) * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const type = pickType();
  const stream = canvas.captureStream(path.fps);
  const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: type || "video/webm" }))));

  const paint = (f: number) => {
    drawFrame(ctx, w, h, path, f, style);
    const pad = Math.round(h * 0.05);
    // Frame lines.
    ctx.strokeStyle = "rgba(244,244,236,0.5)";
    ctx.lineWidth = 2;
    const c = Math.round(h * 0.04);
    for (const [x, y, dx, dy] of [
      [pad, pad, 1, 1],
      [w - pad, pad, -1, 1],
      [pad, h - pad, 1, -1],
      [w - pad, h - pad, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * c);
      ctx.stroke();
    }
    // Slate text.
    const r = readoutAt(path, f);
    ctx.font = `600 ${Math.round(h * 0.034)}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(228,255,26,0.95)";
    ctx.fillText("PREVIS", pad + 6, pad + 6);
    ctx.fillStyle = "rgba(244,244,236,0.9)";
    ctx.fillText(label, pad + 6 + ctx.measureText("PREVIS  ").width, pad + 6);
    ctx.textBaseline = "bottom";
    ctx.fillText(`${Math.round(r.mm)}mm  ${r.height.toFixed(1)}m high  ${r.distance.toFixed(1)}m away`, pad + 6, h - pad - 6);
    const tc = timecode(f, path.fps);
    ctx.fillText(tc, w - pad - 6 - ctx.measureText(tc).width, h - pad - 6);
  };

  paint(0);
  rec.start();
  await new Promise<void>((resolve) => {
    const start = performance.now();
    const step = () => {
      const f = Math.floor(((performance.now() - start) / 1000) * path.fps);
      if (f >= path.frames) return resolve();
      paint(f);
      onProgress?.(f / path.frames);
      setTimeout(step, 1000 / path.fps / 2);
    };
    step();
  });
  // Hold the last frame a beat so players don't cut it off.
  await new Promise((r) => setTimeout(r, 300));
  rec.stop();
  stream.getTracks().forEach((t) => t.stop());
  return done;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

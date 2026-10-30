"use client";

import { useEffect, useRef } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import { previsFrame } from "./previs";
import { drawFrame, drawOverview, type RigStyle } from "./rig";

/**
 * Plays a camera path through the ghost-rig scene, in a loop. `playing=false` holds frame 0
 * (move tiles animate only on hover). `shared` follows the monitor's previs clock instead, so
 * it pauses and scrubs with the timeline. Reports the current frame for timecode overlays.
 */
export function RigView({
  path,
  style,
  view = "camera",
  playing = true,
  shared = false,
  onFrame,
  className,
}: {
  path: CameraPath;
  style: RigStyle;
  view?: "camera" | "overview";
  playing?: boolean;
  shared?: boolean;
  onFrame?: (frame: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pathRef = useRef(path);
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    pathRef.current = path;
    onFrameRef.current = onFrame;
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let visible = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    const draw = (frame: number) => {
      const p = pathRef.current;
      if (view === "overview") drawOverview(ctx, canvas.width, canvas.height, p, frame, style);
      else drawFrame(ctx, canvas.width, canvas.height, p, frame, style);
      onFrameRef.current?.(frame);
    };
    let last = -1;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const p = pathRef.current;
      // Loop with a short hold on the last frame, like a previs reel.
      const hold = Math.round(p.fps * 0.6);
      const cycle = p.frames + hold;
      const frame = shared ? previsFrame(p.frames) : Math.min(p.frames - 1, Math.floor(((now - start) / 1000) * p.fps) % cycle);
      if (frame === last) return;
      last = frame;
      draw(frame);
    };
    const animate = shared || (playing && !reduce);
    if (animate) raf = requestAnimationFrame(tick);
    else requestAnimationFrame(() => draw(playing ? Math.floor(pathRef.current.frames / 2) : 0));
    const redrawOnResize = new ResizeObserver(() => {
      if (shared) last = -1;
      else if (!animate) draw(0);
    });
    redrawOnResize.observe(canvas);
    return () => {
      redrawOnResize.disconnect();
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [style, view, playing, shared, path]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

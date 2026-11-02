"use client";

// A camera move's tile preview. With the 3D set as the scene (the default), it shows the move
// through the same 3D set as the monitor; with a ghost-rig scene, or without WebGL, the wireframe.
// At rest it holds the first frame; hovered or chosen, it plays in a loop.

import { useEffect, useRef, useState } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import { RigView } from "./RigView";
import { useStudio } from "./state";

type Tiles = typeof import("./three/tileRender");
let tiles: Promise<Tiles> | null = null;
const loadTiles = () => (tiles ??= import("./three/tileRender"));

export function MoveThumb({ path, playing, className }: { path: CameraPath; playing: boolean; className?: string }) {
  const set3d = useStudio((s) => s.shot.rigStyle === "set3d");
  const [failed, setFailed] = useState(false);
  if (!set3d || failed) return <RigView path={path} style="subject" playing={playing} className={className} />;
  return <Thumb3D path={path} playing={playing} className={className} onFail={() => setFailed(true)} />;
}

function Thumb3D({ path, playing, className, onFail }: { path: CameraPath; playing: boolean; className?: string; onFail: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ path, onFail });
  useEffect(() => {
    latest.current = { path, onFail };
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let alive = true;
    let raf = 0;
    let visible = false;
    let mod: Tiles | null = null;
    const animate = playing && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();

    const paint = (frame: number) => {
      if (!alive || !mod) return;
      try {
        mod.paintTile(canvas, latest.current.path, frame);
      } catch {
        alive = false;
        latest.current.onFail();
      }
    };
    // At rest: the first frame, drawn in turn with the other tiles, and again once its 3D takes load.
    const rest = () => {
      if (!mod || !visible) return;
      const m = mod;
      m.queuePaint(canvas, () => {
        paint(0);
        if (alive && m.tilesLoading()) void m.tilesReady().then(() => alive && m.queuePaint(canvas, () => paint(0)));
      });
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible) return;
      const p = latest.current.path;
      // Loop with a short hold on the last frame, like a previs reel.
      const cycle = p.frames + Math.round(p.fps * 0.6);
      paint(Math.min(p.frames - 1, Math.floor(((now - start) / 1000) * p.fps) % cycle));
    };

    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      if (!animate) rest();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting;
      if (visible && !was && !animate) rest();
    });
    io.observe(canvas);

    loadTiles()
      .then((m) => {
        if (!alive) return;
        mod = m;
        resize();
        if (animate) raf = requestAnimationFrame(tick);
        else rest();
      })
      .catch(() => alive && latest.current.onFail());

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mod?.dropPaint(canvas);
    };
  }, [playing, path]);

  return <canvas ref={ref} className={className} aria-hidden />;
}

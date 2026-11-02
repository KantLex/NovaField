// The previs set seen through the shot's camera: live in the monitor, and frame by frame for the
// guide video H3 follows and the previs you save. Only imported dynamically, with three.js.

import * as THREE from "three";
import type { CameraPath } from "@/lib/cinema/camera";
import type { LightFrom } from "@/lib/cinema/looks";
import { previsFrame } from "../previs";
import { aimLens, previsSet } from "./previsSet";
import { tr } from "@/i18n";

/**
 * The monitor's lens view on `canvas`, following the previs clock. `read` gives the latest path;
 * `onFrame` hears each new frame (for the timecode).
 */
export function createLens(canvas: HTMLCanvasElement, read: () => CameraPath, onFrame?: (frame: number) => void, readLight?: () => LightFrom): { dispose: () => void } {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const set = previsSet(scene, renderer);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.05, 200);

  const resize = () => renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  // Off screen (scrolled away, behind another view): don't draw.
  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);

  let last = -1;
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const path = read();
    set.light(readLight?.() ?? "auto");
    set.sync(path);
    const frame = previsFrame(path.frames);
    set.place(path, frame);
    aimLens(cam, path, frame, (canvas.clientWidth || 1) / (canvas.clientHeight || 1));
    renderer.render(scene, cam);
    if (frame !== last) onFrame?.(frame);
    last = frame;
  });

  return {
    dispose: () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      set.dispose();
      renderer.dispose();
      // Hand the context back now: browsers hold only a few, and drop the oldest past that.
      renderer.forceContextLoss();
    },
  };
}

/**
 * Draws the shot through its camera at `width`×`height`, any frame on demand, once the 3D takes in
 * it have loaded. `canvas` holds the last frame drawn.
 */
export async function lensPainter(path: CameraPath, width: number, height: number, light: LightFrom = "auto") {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  const set = previsSet(scene, renderer);
  set.light(light);
  const cam = new THREE.PerspectiveCamera(40, width / height, 0.05, 200);
  set.sync(path);
  await set.ready();
  set.sync(path);
  return {
    canvas,
    draw: (frame: number) => {
      set.place(path, frame);
      aimLens(cam, path, frame, width / height);
      renderer.render(scene, cam);
    },
    dispose: () => {
      set.dispose();
      renderer.dispose();
      // Hand the context back now: browsers hold only a few, and drop the oldest past that.
      renderer.forceContextLoss();
    },
  };
}

/** The guide H3 follows: every frame of the shot through its camera, as JPEG stills `width` wide. */
export async function guideFrames(path: CameraPath, ratio: number, width = 480, onProgress?: (pct: number) => void, light: LightFrom = "auto"): Promise<Blob[]> {
  const height = Math.round(width / ratio / 2) * 2;
  const painter = await lensPainter(path, width, height, light);
  try {
    const frames: Blob[] = [];
    for (let f = 0; f < path.frames; f++) {
      painter.draw(f);
      frames.push(await new Promise<Blob>((resolve, reject) => painter.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr("Couldn't draw the 3D previs.")))), "image/jpeg", 0.82)));
      onProgress?.((f + 1) / path.frames);
    }
    return frames;
  } finally {
    painter.dispose();
  }
}

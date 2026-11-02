// One WebGL renderer for every camera-move tile. A page can hold only a handful of WebGL contexts,
// so each tile is a plain 2D canvas: this draws the previs set through the tile's camera and copies
// the picture across. Tiles at rest are drawn once, a few per animation frame so a long list
// doesn't stall; a playing tile draws every frame. Only imported dynamically, with three.js.

import * as THREE from "three";
import type { CameraPath } from "@/lib/cinema/camera";
import { aimLens, previsSet, type PrevisSet } from "./previsSet";

let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; set: PrevisSet; cam: THREE.PerspectiveCamera } | null = null;

function studio() {
  if (!shared) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const made = { renderer, scene, set: previsSet(scene, renderer), cam: new THREE.PerspectiveCamera(40, 1, 0.05, 200) };
    // If the browser takes the context back (too many open at once), start afresh on the next
    // draw. The tiles keep the pictures already copied into them.
    renderer.domElement.addEventListener("webglcontextlost", () => {
      if (shared === made) shared = null;
      made.set.dispose();
      renderer.dispose();
    });
    shared = made;
  }
  return shared;
}

/** Draw `path` at `frame` into `canvas` (a 2D canvas, at its own pixel size). Throws without WebGL. */
export function paintTile(canvas: HTMLCanvasElement, path: CameraPath, frame: number) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  if (!ctx || w < 2 || h < 2) return;
  const { renderer, scene, set, cam } = studio();
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
  set.sync(path);
  set.place(path, frame);
  aimLens(cam, path, frame, w / h);
  renderer.render(scene, cam);
  ctx.drawImage(renderer.domElement, 0, 0, w, h);
}

/** True while a 3D take a tile showed is still loading; `tilesReady` settles when they all have. */
export const tilesLoading = () => studio().set.loading();
export const tilesReady = () => studio().set.ready();

const queue = new Map<HTMLCanvasElement, () => void>();
let scheduled = false;

/** Draw a tile at rest soon, after any already waiting. A newer request for the same tile replaces the older. */
export function queuePaint(canvas: HTMLCanvasElement, paint: () => void) {
  queue.set(canvas, paint);
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    const until = performance.now() + 8;
    for (const [c, p] of queue) {
      queue.delete(c);
      p();
      if (performance.now() > until) break;
    }
    if (queue.size) requestAnimationFrame(run);
    else scheduled = false;
  };
  requestAnimationFrame(run);
}

/** Forget a tile that's gone. */
export const dropPaint = (canvas: HTMLCanvasElement) => queue.delete(canvas);

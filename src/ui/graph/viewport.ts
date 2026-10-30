"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NODE_W, type Pos } from "@/lib/comfy/edit";
import type { Doc } from "./doc";

/** Where the canvas is panned to (pixels) and how far it's zoomed. */
export type View = { x: number; y: number; z: number };

export const clampZ = (z: number) => Math.min(2, Math.max(0.2, z));

/**
 * Pan and zoom over the graph canvas: wheel to pan, ⌘/Ctrl-wheel (and trackpad pinch) to zoom around
 * the pointer, and fitting nodes into view. Until the person moves the view, the whole graph is kept
 * in view while the panel settles and resizes.
 */
export function useViewport(canvas: React.RefObject<HTMLDivElement | null>, docRef: React.RefObject<Doc | null>, heightOf: (id: string) => number, hasDoc: boolean) {
  const [view, setView] = useState<View>({ x: 40, y: 40, z: 0.85 });
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const touched = useRef(false);

  const toWorld = (cx: number, cy: number): Pos => {
    const r = canvas.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(cx - r.left - v.x) / v.z, (cy - r.top - v.y) / v.z];
  };

  // A plain function: the resize observer below always calls the latest one through fitRef.
  const fit = (only?: string[], readable = false) => {
    const d = docRef.current;
    const el = canvas.current;
    if (!d || !el) return;
    const ids = only?.length ? only : Object.keys(d.layout);
    if (!ids.length) return;
    const xs = ids.map((id) => d.layout[id][0]);
    const ys = ids.map((id) => d.layout[id][1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_W;
    const maxY = Math.max(...ids.map((id) => d.layout[id][1] + heightOf(id)));
    const W = el.clientWidth;
    const H = el.clientHeight;
    const whole = clampZ(Math.min(1, (W - 80) / (maxX - minX), (H - 80) / (maxY - minY)));
    // A first look stays readable: a wide graph opens at its start (where the flow begins) rather than as a thumbnail.
    const z = readable ? Math.max(whole, 0.55) : whole;
    const x = z > whole ? 40 - minX * z : (W - (maxX - minX) * z) / 2 - minX * z;
    setView({ z, x, y: Math.max(40 - minY * z, (H - (maxY - minY) * z) / 2 - minY * z) });
  };

  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  });
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || !hasDoc) return;
    fitRef.current(undefined, true);
    const ro = new ResizeObserver(() => !touched.current && fitRef.current(undefined, true));
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas, hasDoc]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-scrolls]")) return;
      e.preventDefault();
      touched.current = true;
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        const z = clampZ(v.z * Math.exp(-e.deltaY * 0.0085));
        setView({ z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z });
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [canvas, hasDoc]);

  /** Zoom by a factor around the top-left, as the toolbar buttons do. */
  const zoomBy = (f: number) => {
    touched.current = true;
    setView((v) => ({ ...v, z: clampZ(v.z * f) }));
  };

  return { view, setView, viewRef, touched, toWorld, fit, zoomBy };
}

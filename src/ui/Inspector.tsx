"use client";

// Full-screen look at a take. Pictures open fitted to the screen; click (or scroll) to zoom in
// to actual pixels and drag to look around. Clips play large with the browser's own controls.

import clsx from "clsx";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Job } from "@/lib/jobs";
import { tr } from "@/i18n";

const MAX_ZOOM = 8;

/** The corner button that opens the inspector. */
export function InspectButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={tr("View full size")}
      title={tr("View full size")}
      className={clsx("flex items-center justify-center rounded-md bg-black/60 p-1.5 text-ink/90 backdrop-blur transition-colors hover:bg-black/80 hover:text-ink", className)}
    >
      <Maximize2 size={14} />
    </button>
  );
}

export function Inspector({ job, onClose }: { job: Job; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // Zoom 0 means "fit"; otherwise screen pixels per image pixel.
  const [zoom, setZoom] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  useEffect(() => {
    // Captured first and kept here: Esc closes only this, not a take viewer open underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "0") setZoom(0);
      if (e.key === "1") setZoom(1);
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = natural && box.w ? Math.min(box.w / natural.w, box.h / natural.h, 1) : 1;
  const scale = zoom || fit;
  const w = natural ? natural.w * scale : 0;
  const h = natural ? natural.h * scale : 0;

  /** Keep the picture over the stage: no panning past its edges. */
  const clamp = useCallback(
    (p: { x: number; y: number }, s: number) => {
      if (!natural) return p;
      const mx = Math.max(0, (natural.w * s - box.w) / 2);
      const my = Math.max(0, (natural.h * s - box.h) / 2);
      return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
    },
    [natural, box],
  );

  /** Zoom to `next`, keeping the image point under (cx, cy) where it is. */
  const zoomAt = (next: number, cx: number, cy: number) => {
    const s = Math.max(fit, Math.min(MAX_ZOOM, next));
    const rect = stage.current!.getBoundingClientRect();
    const ox = cx - rect.left - rect.width / 2;
    const oy = cy - rect.top - rect.height / 2;
    const k = s / scale;
    const fitted = s <= fit + 1e-6;
    setPan(fitted ? { x: 0, y: 0 } : clamp({ x: ox - (ox - pan.x) * k, y: oy - (oy - pan.y) * k }, s));
    setZoom(fitted ? 0 : s);
  };

  const step = (dir: 1 | -1) => {
    const rect = stage.current!.getBoundingClientRect();
    zoomAt(scale * (dir > 0 ? 1.5 : 1 / 1.5), rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const image = !job.video && job.image;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black" role="dialog" aria-modal aria-label={job.title}>
      <div className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
        <p className="min-w-0 flex-1 truncate text-ink/85">{job.title}</p>
        {image && natural && (
          <>
            <span className="readout text-[13px] text-dim">
              {natural.w}×{natural.h}
            </span>
            <div className="flex items-center gap-0.5 rounded-md bg-raised p-0.5">
              <button onClick={() => step(-1)} aria-label={tr("Zoom out")} className="rounded p-1 hover:bg-hover" disabled={!zoom}>
                <Minus size={14} />
              </button>
              <button onClick={() => (zoom ? setZoom(0) : zoomAt(1, window.innerWidth / 2, window.innerHeight / 2))} className="readout min-w-[52px] rounded px-1 text-center text-[13px] hover:bg-hover" title={tr("Fit or actual size (0 / 1)")}>
                {Math.round(scale * 100)}%
              </button>
              <button onClick={() => step(1)} aria-label={tr("Zoom in")} className="rounded p-1 hover:bg-hover">
                <Plus size={14} />
              </button>
            </div>
          </>
        )}
        <button onClick={onClose} aria-label={tr("Close")} className="rounded p-1 text-dim hover:bg-raised hover:text-ink">
          <X size={18} />
        </button>
      </div>

      <div
        ref={stage}
        className={clsx("relative min-h-0 flex-1 overflow-hidden", image && (zoom ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"))}
        onClick={(e) => {
          if (!image && e.target === e.currentTarget) onClose();
        }}
        onWheel={(e) => image && natural && zoomAt(scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)}
        onPointerDown={(e) => {
          if (!image) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
          if (zoom) setPan(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }, scale));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          // A click (not a drag) toggles between fitted and actual pixels at that spot.
          if (d && !d.moved) {
            if (zoom) {
              setZoom(0);
              setPan({ x: 0, y: 0 });
            } else zoomAt(Math.max(1, fit * 2), e.clientX, e.clientY);
          }
        }}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.image}
            alt={job.title}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute top-1/2 left-1/2 max-w-none select-none"
            style={{
              width: w || undefined,
              height: h || undefined,
              transform: `translate(calc(-50% + ${zoom ? pan.x : 0}px), calc(-50% + ${zoom ? pan.y : 0}px))`,
              imageRendering: scale >= 2 ? "pixelated" : undefined,
              visibility: natural ? "visible" : "hidden",
            }}
          />
        ) : job.video ? (
          <video src={job.video} poster={job.poster} controls autoPlay loop playsInline className="absolute inset-0 m-auto max-h-full max-w-full" />
        ) : null}
      </div>
      {image && <p className="pb-2 text-center text-[12px] text-faint">{tr("Click to zoom, drag to look around, scroll to zoom. Esc closes.")}</p>}
    </div>,
    document.body,
  );
}

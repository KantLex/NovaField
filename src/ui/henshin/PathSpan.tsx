"use client";

// When a motion path moves: the span of the shot it covers and how it eases.

import clsx from "clsx";
import { useRef, useState } from "react";
import type { PathTiming } from "@/lib/engines/specs";
import { tr } from "@/i18n";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const EASES: { id: PathTiming["ease"]; label: string }[] = [
  { id: "smooth", label: "Smooth" },
  { id: "linear", label: "Steady" },
  { id: "in", label: "Speed up" },
  { id: "out", label: "Slow down" },
];

/** When a path moves: a start and an end inside the clip, shown as a span over a bar. */
export function Span({ value: saved, seconds, onChange }: { value: PathTiming; seconds: number; onChange: (p: Partial<PathTiming>) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<"start" | "end" | null>(null);
  // Shown live while dragging, saved once on release (one undo step per drag).
  const [live, setLive] = useState<PathTiming | null>(null);
  const value = live ?? saved;
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.round(clamp01((clientX - r.left) / r.width) * 100) / 100;
  };
  const move = (clientX: number) => {
    const v = at(clientX);
    if (drag === "start") setLive({ ...value, start: Math.min(v, value.end - 0.05) });
    if (drag === "end") setLive({ ...value, end: Math.max(v, value.start + 0.05) });
  };
  return (
    <div className="flex items-center gap-3">
      <span className="w-[74px] shrink-0 text-[13px] text-dim">{tr("Moves")}</span>
      <div
        ref={bar}
        className="relative h-5 flex-1 touch-none"
        onPointerMove={(e) => drag && move(e.clientX)}
        onPointerUp={() => {
          if (live) onChange({ start: live.start, end: live.end });
          setLive(null);
          setDrag(null);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-raised" />
        <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-tungsten/70" style={{ left: `${value.start * 100}%`, width: `${(value.end - value.start) * 100}%` }} />
        {(["start", "end"] as const).map((edge) => (
          <button
            key={edge}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              setDrag(edge);
            }}
            onKeyDown={(e) => {
              const step = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
              if (!step) return;
              e.preventDefault();
              if (edge === "start") onChange({ start: clamp01(Math.min(value.start + step, value.end - 0.05)) });
              else onChange({ end: clamp01(Math.max(value.end + step, value.start + 0.05)) });
            }}
            className={clsx("absolute top-1/2 size-3.5 -translate-1/2 cursor-ew-resize rounded-full border-2 border-black/50 bg-tungsten", drag === edge && "scale-110")}
            style={{ left: `${value[edge] * 100}%` }}
            aria-label={edge === "start" ? tr("Starts moving") : tr("Stops moving")}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(value[edge] * 100)}
          />
        ))}
      </div>
      <span className="readout w-[86px] text-right text-[13px] text-ink/85">
        {(value.start * seconds).toFixed(1)}–{(value.end * seconds).toFixed(1)} s
      </span>
    </div>
  );
}

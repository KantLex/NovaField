"use client";

// Which part of a long clip Henshin uses. The bar is the whole original; the bright window is the
// part. Drag the window to move it, or (for Recast and Restyle) its ends to make it shorter or
// longer. A frame from the original follows the drag, and "Use this part" cuts it again.

import clsx from "clsx";
import { Scissors } from "lucide-react";
import { useRef, useState } from "react";
import type { Asset } from "@/lib/engines/specs";
import { api, fail } from "../api";
import { ask } from "@/ui/ask";
import { tr } from "@/i18n";

/** Shortest part both models take, in seconds: H3's 56 frames at 24 fps, Wan's 33 at 16. */
const MIN = 2.4;

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function TrimBar({
  clip,
  purpose,
  max,
  fixed,
  warn,
  onClip,
}: {
  clip: Asset;
  purpose: "h3" | "wan";
  /** Longest part the model takes, in seconds. */
  max: number;
  /** The part is always as long as it can be (Replace): only its start moves. */
  fixed?: boolean;
  /** Said before cutting, when choosing another part throws work away. */
  warn?: string;
  onClip: (a: Asset) => void;
}) {
  const src = clip.source;
  const bar = useRef<HTMLDivElement>(null);
  const peek = useRef<HTMLVideoElement>(null);
  const used = clip.duration ?? 0;
  const [win, setWin] = useState<{ start: number; end: number } | null>(null);
  const [drag, setDrag] = useState<{ part: "move" | "in" | "out"; x0: number; from: { start: number; end: number } } | null>(null);
  const [busy, setBusy] = useState(false);
  // Clips added before parts could be chosen, or short enough to use whole: nothing to choose.
  if (!src || src.duration < MIN + 0.2 || (src.duration <= max + 0.05 && fixed)) return null;

  const total = src.duration;
  const current = { start: src.start, end: Math.min(total, src.start + used) };
  const shown = win ?? current;
  const changed = Math.abs(shown.start - current.start) > 0.04 || Math.abs(shown.end - current.end) > 0.04;
  const at = (x: number) => (x / bar.current!.getBoundingClientRect().width) * total;
  const show = (t: number) => {
    if (peek.current) peek.current.currentTime = Math.min(total - 0.05, Math.max(0, t));
  };

  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = at(e.clientX - drag.x0);
    const f = drag.from;
    let next: { start: number; end: number };
    if (drag.part === "move") {
      const len = f.end - f.start;
      const start = Math.min(total - len, Math.max(0, f.start + d));
      next = { start, end: start + len };
    } else if (drag.part === "in") next = { start: Math.min(f.end - MIN, Math.max(0, f.end - max, f.start + d)), end: f.end };
    else next = { start: f.start, end: Math.max(f.start + MIN, Math.min(total, f.start + max, f.end + d)) };
    setWin(next);
    show(drag.part === "out" ? next.end : next.start);
  };

  const apply = async () => {
    if (warn && !(await ask(warn))) return;
    setBusy(true);
    try {
      onClip(await api.trim(clip, purpose, shown.start, fixed ? undefined : shown.end - shown.start));
      setWin(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const grab = (part: "move" | "in" | "out") => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // The peek frame mounts with the drag and seeks itself once loaded.
    setDrag({ part, x0: e.clientX, from: shown });
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surround/60 p-2">
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="flex items-center gap-1.5 text-dim">
          <Scissors size={12} />
          {tr("Part used")}
          <span className="readout text-[13px] text-ink/85">
            {clock(shown.start)} – {clock(shown.end)}
          </span>
          <span className="text-faint">{tr("of {total}", { total: clock(total) })}</span>
        </span>
        {changed && (
          <span className="flex items-center gap-2">
            <button onClick={() => setWin(null)} disabled={busy} className="text-dim hover:text-ink">
              {tr("Undo")}
            </button>
            <button onClick={() => void apply()} disabled={busy} className="rounded bg-tungsten px-2 py-0.5 font-semibold text-black disabled:opacity-60">
              {busy ? tr("Cutting…") : tr("Use this part")}
            </button>
          </span>
        )}
      </div>
      <div ref={bar} className="relative h-7 touch-none" onPointerMove={move} onPointerUp={() => setDrag(null)}>
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-raised" />
        <div
          role="slider"
          aria-label={tr("Part used")}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={shown.start}
          tabIndex={0}
          onPointerDown={grab("move")}
          onKeyDown={(e) => {
            const d = e.key === "ArrowLeft" ? -0.5 : e.key === "ArrowRight" ? 0.5 : 0;
            if (!d) return;
            e.preventDefault();
            const len = shown.end - shown.start;
            const start = Math.min(total - len, Math.max(0, shown.start + d));
            setWin({ start, end: start + len });
          }}
          className={clsx("absolute top-0 bottom-0 cursor-grab rounded-[3px] border-2 border-tungsten bg-tungsten/25", drag?.part === "move" && "cursor-grabbing")}
          style={{ left: `${(shown.start / total) * 100}%`, width: `${((shown.end - shown.start) / total) * 100}%` }}
        >
          {!fixed &&
            (["in", "out"] as const).map((p) => (
              <span
                key={p}
                onPointerDown={grab(p)}
                className={clsx("absolute top-0 bottom-0 w-3 cursor-ew-resize", p === "in" ? "-left-1.5" : "-right-1.5")}
                title={tr(p === "in" ? "Drag to start later or earlier" : "Drag to end earlier or later")}
              >
                <span className="absolute inset-y-1 left-1/2 w-1 -translate-x-1/2 rounded-full bg-tungsten" />
              </span>
            ))}
        </div>
        {drag && (
          // The frame where the part starts (or ends), from the original.
          <video
            ref={peek}
            src={src.url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={() => show(drag.part === "out" ? shown.end : shown.start)}
            className="pointer-events-none absolute bottom-9 w-40 -translate-x-1/2 rounded-[3px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_8px_24px_rgba(0,0,0,0.6)]"
            style={{ left: `${(((drag.part === "out" ? shown.end : shown.start) / total) * 100).toFixed(2)}%` }}
          />
        )}
      </div>
    </div>
  );
}

"use client";

// The timeline: clips at their length, a ruler to scrub, trim handles on each clip's edges, a
// cut/dissolve switch on each join. Drag a clip to move it; drop a take from the bin to insert it.

import clsx from "clsx";
import { FastForward, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { Job } from "@/lib/jobs";
import { timecode, type Clip, type Placed } from "@/lib/sequence";
import { tr } from "@/i18n";
import type { Playhead } from "./playhead";
import { sourceOf } from "../sequence";

export const TAKE_MIME = "application/x-novafield-take";
const CLIP_MIME = "application/x-novafield-clip";

interface Props {
  placed: Placed[];
  total: number;
  jobs: Record<string, Job>;
  playhead: Playhead;
  /** Pixels per second. */
  scale: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Live while dragging a trim handle; `done` once on release. */
  onTrim: (index: number, edge: "in" | "out", value: number, done: boolean) => void;
  onMove: (from: number, to: number) => void;
  onInsert: (take: string, index: number) => void;
  onJoin: (index: number) => void;
}

const HANDLE = 7;

export function Timeline({ placed, total, jobs, playhead, scale, selected, onSelect, onTrim, onMove, onInsert, onJoin }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const width = Math.max(total * scale + 160, 300);

  // The playhead line follows the edit without re-rendering; while playing it keeps itself in view.
  useEffect(
    () =>
      playhead.on((t, playing) => {
        const x = t * scale;
        if (line.current) line.current.style.transform = `translateX(${x}px)`;
        const s = scroller.current;
        if (playing && s && (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 40)) s.scrollLeft = x - 40;
      }),
    [playhead, scale],
  );

  const ticks = useMemo(() => {
    // A label every 1, 2, 5, 10… seconds, whichever keeps labels ~80px apart.
    const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * scale >= 80) ?? 60;
    const out: number[] = [];
    for (let t = 0; t <= total + step; t += step) out.push(t);
    return { step, out };
  }, [scale, total]);

  const timeAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return (clientX - r.left + scroller.current!.scrollLeft) / scale;
  };

  /** Where a drop at clientX lands: before the first clip whose middle is to its right. */
  const indexAt = (clientX: number) => {
    const t = timeAt(clientX);
    const i = placed.findIndex((p) => p.start + p.length / 2 > t);
    return i < 0 ? placed.length : i;
  };

  const scrub = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    playhead.setPlaying(false);
    playhead.seek(timeAt(e.clientX));
  };

  const trimDrag = (e: React.PointerEvent, p: Placed, edge: "in" | "out") => {
    e.stopPropagation();
    e.preventDefault();
    playhead.setPlaying(false);
    const x0 = e.clientX;
    const from = edge === "in" ? p.clip.in : p.clip.out;
    const value = (ev: PointerEvent) => from + (ev.clientX - x0) / scale;
    // Show the frame being trimmed to in the monitor.
    const show = (v: number) => playhead.seek(edge === "in" ? p.start : p.start + (v - p.clip.in));
    const move = (ev: PointerEvent) => {
      onTrim(p.index, edge, value(ev), false);
      show(value(ev));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onTrim(p.index, edge, value(ev), true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={scroller}
      className="relative overflow-x-auto overflow-y-hidden rounded-md bg-[#141414] select-none"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TAKE_MIME) || e.dataTransfer.types.includes(CLIP_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        const take = e.dataTransfer.getData(TAKE_MIME);
        const clip = e.dataTransfer.getData(CLIP_MIME);
        const to = indexAt(e.clientX);
        if (take) onInsert(take, to);
        else if (clip) {
          const from = Number(clip);
          onMove(from, to > from ? to - 1 : to);
        }
      }}
    >
      <div className="relative" style={{ width }}>
        {/* Ruler: click or drag to move the playhead. */}
        <div className="relative h-6 cursor-ew-resize border-b border-white/[0.06]" onPointerDown={scrub} onPointerMove={(e) => e.buttons && playhead.seek(timeAt(e.clientX))}>
          {ticks.out.map((t) => (
            <span key={t} className="absolute top-0 flex h-full items-end pb-0.5 pl-1 text-[10px] text-faint" style={{ left: t * scale, borderLeft: "1px solid rgba(255,255,255,0.12)" }}>
              <span className="readout text-[11px]">{timecode(t).slice(0, 5)}</span>
            </span>
          ))}
        </div>

        {/* The clips. Empty track space scrubs too. */}
        <div className="relative h-[92px]" onPointerDown={(e) => e.target === e.currentTarget && (onSelect(null), scrub(e))} onPointerMove={(e) => e.target === e.currentTarget && e.buttons && playhead.seek(timeAt(e.clientX))}>
          {placed.map((p) => {
            const job = jobs[p.clip.take];
            const src = sourceOf(job);
            const w = Math.max(6, p.length * scale);
            const sel = selected === p.clip.id;
            return (
              <div
                key={p.clip.id}
                data-clip={p.clip.id}
                data-shatter-src={job?.poster}
                data-shatter-aspect={job?.meta && job.meta.height > 0 ? job.meta.width / job.meta.height : 16 / 9}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(CLIP_MIME, String(p.index));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(p.clip.id);
                }}
                className={clsx(
                  "group absolute top-2 bottom-2 cursor-grab overflow-hidden rounded-[3px] bg-black active:cursor-grabbing",
                  sel ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_rgba(255,255,255,0.1)]",
                )}
                style={{ left: p.start * scale, width: w, zIndex: sel ? 30 : p.index + 1 }}
                title={`${job?.title ?? ""}\n${timecode(p.length)}`}
              >
                {/* The take's filmstrip, cropped to the clip's in and out. */}
                {job?.strip ? (
                  <Thumbs strip={job.strip} clip={p.clip} seconds={src?.seconds || p.length} width={w} scale={scale} aspect={job.meta && job.meta.height > 0 ? job.meta.width / job.meta.height : 16 / 9} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  job?.poster && <img src={job.poster} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
                )}
                {p.fadeIn > 0 && <span className="absolute inset-y-0 left-0 bg-gradient-to-r from-black/85 to-transparent" style={{ width: p.fadeIn * scale }} aria-hidden />}
                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/85 to-transparent px-2 pt-4 pb-1 text-[11px]">
                  <span className="readout text-[12px] text-tungsten">{p.index + 1}</span>
                  {p.clip.muted && <VolumeX size={11} className="shrink-0 text-tally" aria-label={tr("Muted")} />}
                  {(job?.meta?.trimHead ?? 0) > 0 && p.index > 0 && <FastForward size={11} className="shrink-0 text-tungsten" aria-label={tr("continues")} />}
                  <span className="min-w-0 flex-1 truncate text-ink/80">{job?.title}</span>
                </span>
                {/* Trim handles. */}
                {(["in", "out"] as const).map((edge) => (
                  <span
                    key={edge}
                    onPointerDown={(e) => {
                      onSelect(p.clip.id);
                      trimDrag(e, p, edge);
                    }}
                    className={clsx(
                      "absolute inset-y-0 z-10 cursor-ew-resize bg-tungsten/0 transition-colors group-hover:bg-tungsten/60",
                      sel && "bg-tungsten/80",
                      edge === "in" ? "left-0 rounded-l-[3px]" : "right-0 rounded-r-[3px]",
                    )}
                    style={{ width: HANDLE }}
                    aria-label={tr(edge === "in" ? "Trim the start" : "Trim the end")}
                  />
                ))}
              </div>
            );
          })}

          {/* Joins: cut or dissolve. */}
          {placed.slice(1).map((p) => (
            <button
              key={`join-${p.clip.id}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onJoin(p.index)}
              className={clsx(
                "absolute top-0 z-40 flex h-4 -translate-x-1/2 items-center rounded px-1 text-[10px] font-semibold",
                p.clip.join === "dissolve" ? "bg-tungsten text-black" : "bg-raised text-dim hover:text-ink",
              )}
              style={{ left: (p.start + p.fadeIn / 2) * scale }}
              title={tr(p.clip.join === "dissolve" ? "Dissolve: click for a straight cut" : "Cut: click for a dissolve")}
            >
              {p.clip.join === "dissolve" ? tr("Dissolve") : tr("Cut")}
            </button>
          ))}
        </div>

        <div ref={line} className="pointer-events-none absolute top-0 bottom-0 left-0 z-50 w-px bg-tally" aria-hidden>
          <span className="absolute -top-px -left-[5px] size-[11px] rotate-45 rounded-[2px] bg-tally" />
        </div>
      </div>
    </div>
  );
}

const STRIP_FRAMES = 10;
const MAX_THUMBS = 60;
const TRACK = 76;

/** Frames at their own shape along the clip, each the strip frame nearest its moment in the take. */
function Thumbs({ strip, clip, seconds, width, scale, aspect }: { strip: string; clip: Clip; seconds: number; width: number; scale: number; aspect: number }) {
  const tw = Math.round(TRACK * aspect);
  // Frames at their own width; a very long clip at high zoom gets wider ones rather than a blank tail.
  const n = Math.min(MAX_THUMBS, Math.ceil(width / tw));
  const slot = Math.max(tw, width / n);
  return (
    <span className="absolute inset-0 flex" aria-hidden>
      {Array.from({ length: n }, (_, k) => {
        const t = clip.in + ((k + 0.5) * slot) / scale;
        const f = Math.min(STRIP_FRAMES - 1, Math.max(0, Math.floor((t / Math.max(seconds, 0.01)) * STRIP_FRAMES)));
        return (
          <span
            key={k}
            className="h-full shrink-0"
            style={{ width: slot, backgroundImage: `url(${strip})`, backgroundSize: `${slot * STRIP_FRAMES}px 100%`, backgroundPosition: `-${f * slot}px 0` }}
          />
        );
      })}
    </span>
  );
}

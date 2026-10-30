"use client";

import clsx from "clsx";
import { Download, Grid3x3, LoaderCircle, Pause, Play, Repeat, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ease, linearTimeFor, type CameraPath } from "@/lib/cinema/camera";
import { speedCurve } from "@/lib/cinema/metrics";
import { MOVES, type MoveLayer } from "@/lib/cinema/moves";
import { timecode } from "@/lib/engines/sizing";
import { fail, toast } from "./api";
import { Menu, MenuItem } from "./Menu";
import { previsFrame, usePrevis } from "./previs";
import { download, recordPrevis } from "./previsExport";
import type { RigStyle } from "./rig";
import { tr } from "@/i18n";

const WINDOW: Record<MoveLayer["when"], [number, number]> = { whole: [0, 1], start: [0, 0.5], end: [0.5, 1] };

/**
 * Transport under the monitor: play, step and scrub the previs. The track shows how fast the
 * camera moves across the shot, when each combined move plays and where the custom marks fall.
 */
export function PrevisTimeline({
  path,
  layers,
  marks,
  onMarkTime,
  style,
  ratio,
  label,
}: {
  path: CameraPath;
  layers?: MoveLayer[] | null;
  /** Custom rig marks, as times 0..1 (A first, B last). */
  marks?: number[];
  /** Makes the marks draggable: a mark's new time (0..1, eased clock), kept in order. */
  onMarkTime?: (i: number, t: number) => void;
  style: RigStyle;
  ratio: number;
  label: string;
}) {
  const playing = usePrevis((s) => s.playing);
  const speed = usePrevis((s) => s.speed);
  const loop = usePrevis((s) => s.loop);
  const thirds = usePrevis((s) => s.thirds);
  const safe = usePrevis((s) => s.safe);
  const hud = usePrevis((s) => s.hud);
  const set = usePrevis((s) => s.set);
  const seek = usePrevis((s) => s.seek);
  const track = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const last = path.frames - 1;

  const curve = useMemo(() => {
    const s = speedCurve(path);
    const max = Math.max(0.5, ...s);
    const pts = s.map((v, i) => `${(i / (s.length - 1)) * 100},${100 - (v / max) * 82}`);
    return `M0,100 L${pts.join(" L")} L100,100 Z`;
  }, [path]);

  // Playhead, timecode and slider value follow the clock without re-rendering React.
  useEffect(() => {
    const paint = () => {
      const f = previsFrame(path.frames);
      if (head.current) head.current.style.left = `${(f / Math.max(1, last)) * 100}%`;
      if (tc.current) tc.current.textContent = timecode(f, path.fps);
      track.current?.setAttribute("aria-valuenow", String(f));
      track.current?.setAttribute("aria-valuetext", timecode(f, path.fps));
    };
    paint();
    return usePrevis.subscribe(paint);
  }, [path.frames, path.fps, last]);

  const frameAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * last);
  };
  const step = (d: number) => seek(Math.max(0, Math.min(last, previsFrame(path.frames) + d)));
  const toggle = () => {
    const s = usePrevis.getState();
    if (!s.playing && previsFrame(path.frames) >= last) set({ frame: 0, playing: true });
    else set({ playing: !s.playing });
  };

  const save = async () => {
    setSaving(0);
    try {
      const blob = await recordPrevis(path, style, ratio, label, (p) => setSaving(p));
      download(blob, `previs-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shot"}`);
      toast("Previs saved to your downloads.", "done");
    } catch (e) {
      fail(e);
    } finally {
      setSaving(null);
    }
  };

  const btn = "flex size-7 shrink-0 items-center justify-center rounded text-ink/75 hover:bg-white/10 hover:text-ink";

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pt-2 text-[12px] sm:flex-nowrap">
      <button className={btn} onClick={() => step(-1)} aria-label={tr("Previous frame")} title={tr("Previous frame (←)")}>
        <SkipBack size={14} />
      </button>
      <button className={clsx(btn, "text-ink")} onClick={toggle} aria-label={playing ? "Pause previs" : "Play previs"} title={tr("Play or pause (space)")}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button className={btn} onClick={() => step(1)} aria-label={tr("Next frame")} title={tr("Next frame (→)")}>
        <SkipForward size={14} />
      </button>

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={tr("Previs timeline")}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={0}
        className="relative order-last h-9 min-w-0 basis-full cursor-ew-resize sm:order-none sm:flex-1 sm:basis-auto touch-none rounded-sm bg-white/[0.04] outline-none focus-visible:ring-1 focus-visible:ring-tungsten"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(frameAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(frameAt(e.clientX));
        }}
        onKeyDown={(e) => {
          const k = e.key;
          if (k === "ArrowLeft" || k === "ArrowRight") step((k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? path.fps : 1));
          else if (k === "Home") seek(0);
          else if (k === "End") seek(last);
          else if (k === " ") toggle();
          else return;
          e.preventDefault();
        }}
      >
        {/* Camera speed across the shot: tall where the camera travels or turns fast. */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[70%] w-full" aria-hidden>
          <path d={curve} fill="rgba(228,255,26,0.16)" stroke="rgba(228,255,26,0.55)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        </svg>

        {/* When each combined move plays. */}
        {layers && layers.length > 1 && (
          <div className="absolute inset-x-0 top-0.5 flex h-3 flex-col gap-px" aria-hidden>
            {layers.map((l, i) => {
              const [a, b] = WINDOW[l.when] ?? WINDOW.whole;
              return (
                <span
                  key={`${l.id}-${i}`}
                  className="absolute h-[3px] rounded-full bg-tungsten/70"
                  style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%`, top: `${i * 4}px` }}
                  title={MOVES.find((m) => m.id === l.id)?.label}
                />
              );
            })}
          </div>
        )}

        {/* Custom marks: A … B. Drag one to change when the camera reaches it; A late or B early holds the camera. */}
        {marks?.map((t, i) => {
          const name = i === 0 ? "A" : i === marks.length - 1 ? "B" : String(i);
          return (
            <span
              key={i}
              className={clsx("group/mark absolute top-0 bottom-0 z-10 w-3 -translate-x-1/2", onMarkTime && "cursor-col-resize")}
              style={{ left: `${linearTimeFor(path.ease, t) * 100}%` }}
              title={onMarkTime ? tr("Mark {name}: drag to change when the camera gets there", { name }) : undefined}
              onPointerDown={(e) => {
                if (!onMarkTime) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!onMarkTime || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
                const r = track.current!.getBoundingClientRect();
                const lin = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                const lo = i === 0 ? 0 : marks[i - 1] + 0.02;
                const hi = i === marks.length - 1 ? 1 : marks[i + 1] - 0.02;
                onMarkTime(i, Math.round(Math.max(lo, Math.min(hi, ease(path.ease, lin))) * 1000) / 1000);
              }}
            >
              <span className={clsx("absolute inset-y-0 left-1/2 w-px", onMarkTime ? "bg-ink/55 group-hover/mark:bg-tungsten" : "bg-ink/35")} />
              {/* A middle mark crowding the next one drops its number; the line stays. */}
              {(i === 0 || i === marks.length - 1 || marks[i + 1] - t > 0.05) && (
                <span className="readout absolute -top-0.5 left-[calc(50%+3px)] text-[10px] text-ink/75">{name}</span>
              )}
            </span>
          );
        })}

        <div ref={head} className="pointer-events-none absolute top-0 bottom-0 w-0" aria-hidden>
          <span className="absolute top-0 bottom-0 -left-px w-0.5 bg-ink" />
          <span className="absolute -top-1 -left-[5px] size-2.5 rotate-45 bg-ink" />
        </div>
      </div>

      <span ref={tc} className="readout w-[74px] shrink-0 text-right text-[13px] text-ink/80">
        00:00:00
      </span>

      <button
        className={clsx(btn, "readout w-8 text-[12px]", speed === 0.5 && "text-tungsten")}
        onClick={() => set({ speed: speed === 1 ? 0.5 : 1 })}
        aria-label={tr(speed === 1 ? "Play at half speed" : "Play at full speed")}
        title={tr("Half speed")}
      >
        {speed === 1 ? "1×" : "½×"}
      </button>
      <button className={clsx(btn, loop ? "text-tungsten" : "text-ink/45")} onClick={() => set({ loop: !loop })} aria-pressed={loop} aria-label={tr("Loop")} title={tr("Loop")}>
        <Repeat size={14} />
      </button>
      <Menu label={tr("Guides")} align="right" trigger={() => <Grid3x3 size={14} className={clsx(thirds || safe ? "text-tungsten" : "text-ink/75")} />}>
        {() => (
          <>
            <MenuItem onClick={() => set({ thirds: !thirds })}>
              <Check on={thirds} /> {tr("Rule of thirds")}
            </MenuItem>
            <MenuItem onClick={() => set({ safe: !safe })}>
              <Check on={safe} /> {tr("Action and title safe")}
            </MenuItem>
            <MenuItem onClick={() => set({ hud: !hud })}>
              <Check on={hud} /> {tr("Camera readout")}
            </MenuItem>
          </>
        )}
      </Menu>
      <button className={clsx(btn, "w-auto gap-1 px-2")} onClick={() => void save()} disabled={saving !== null} title={tr("Save the previs as a video")}>
        {saving !== null ? (
          <>
            <LoaderCircle size={13} className="animate-spin" />
            <span className="readout text-[12px]">{Math.round(saving * 100)}%</span>
          </>
        ) : (
          <>
            <Download size={13} /> <span className="hidden sm:inline">{tr("Save previs")}</span>
          </>
        )}
      </button>
    </div>
  );
}

function Check({ on }: { on: boolean }) {
  return <span className={clsx("inline-block size-3 rounded-sm border", on ? "border-tungsten bg-tungsten" : "border-ink/40")} aria-hidden />;
}

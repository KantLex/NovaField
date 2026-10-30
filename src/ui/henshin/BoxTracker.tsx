"use client";

import clsx from "clsx";
import { ChevronFirst, ChevronLast, Diamond, Eraser, Eye, EyeOff, Pause, Play, Redo2, StepBack, StepForward, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { timecode } from "@/lib/engines/sizing";
import type { Asset, BoxKey } from "@/lib/engines/specs";
import { boxAt, clampBox, putKey, retimeKey } from "@/lib/engines/tracks";
import { tr } from "@/i18n";
import { IconButton } from "../controls";
import { useHotkeys } from "../hotkeys";
import { useHistory } from "../useHistory";
import { Box, HANDLES, Handle, MaskView, ToolButton, resize } from "@/ui/henshin/boxParts";

const HISTORY = 60;

type Gesture =
  | { kind: "draw"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "move" | Handle; from: Box; x0: number; y0: number; box: Box };

/**
 * Scrub the clip and box the thing to replace. Drag inside the box to move it, its handles to
 * resize it, or outside to draw a new one: each change sets a keyframe on that frame, and
 * NovaBoxTrackMask eases between keyframes on the GPU. Keyframes drag along the timeline to retime.
 */
export function BoxTracker({
  source,
  keys,
  shape,
  expand = 0.06,
  feather = 0.1,
  onKeys,
}: {
  source: Asset;
  keys: BoxKey[];
  shape: "rect" | "ellipse";
  expand?: number;
  feather?: number;
  onKeys: (k: BoxKey[]) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const fps = source.fps ?? 16;
  const frames = source.frames ?? 81;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [dragKey, setDragKey] = useState<{ from: number; to: number } | null>(null);
  const [mask, setMask] = useState(false);
  const history = useHistory(keys, onKeys, HISTORY);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      // Seeks land mid-frame, so the frame is the whole number of frames elapsed.
      setFrame(Math.min(frames - 1, Math.max(0, Math.floor(v.currentTime * fps))));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, frames]);

  const seek = (f: number) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = (Math.min(frames - 1, Math.max(0, f)) + 0.5) / fps;
  };

  const { commit, undo, redo } = history;

  const pos = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const shown: Box | null = gesture
    ? gesture.kind === "draw"
      ? { x: Math.min(gesture.x0, gesture.x1), y: Math.min(gesture.y0, gesture.y1), w: Math.abs(gesture.x1 - gesture.x0), h: Math.abs(gesture.y1 - gesture.y0) }
      : gesture.box
    : boxAt(keys, frame);
  const sorted = [...keys].sort((a, b) => a.f - b.f);
  const isKey = keys.some((k) => k.f === frame);
  const prevKey = [...sorted].reverse().find((k) => k.f < frame);
  const nextKey = sorted.find((k) => k.f > frame);
  const keyHere = (b: Box) => commit(putKey(keys, { ...clampBox(b), f: frame }));

  useHotkeys((e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod) return;
    const step = e.shiftKey ? 10 : 1;
    switch (e.key) {
      case " ":
        e.preventDefault();
        return void (playing ? video.current?.pause() : video.current?.play());
      case "ArrowLeft":
        e.preventDefault();
        return seek(frame - step);
      case "ArrowRight":
        e.preventDefault();
        return seek(frame + step);
      case "ArrowUp":
        e.preventDefault();
        return prevKey && seek(prevKey.f);
      case "ArrowDown":
        e.preventDefault();
        return nextKey && seek(nextKey.f);
      case "k":
      case "K":
        return shown && !isKey && keyHere(shown);
      case "m":
      case "M":
        return setMask((m) => !m);
      case "Delete":
      case "Backspace":
        if (!isKey) return;
        e.preventDefault();
        return commit(keys.filter((k) => k.f !== frame));
    }
  });

  // The track's path, one point per frame: where the box's centre goes.
  const trail = keys.length > 1 ? Array.from({ length: frames }, (_, f) => boxAt(keys, f)!).map((b) => `${(b.x + b.w / 2) * 1000},${(b.y + b.h / 2) * 1000}`).join(" ") : "";
  const frameOf = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (frames - 1));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-[3px] bg-black select-none" style={{ aspectRatio: `${source.width ?? 16}/${source.height ?? 9}` }}>
        <video ref={video} src={source.url} className="absolute inset-0 size-full" muted playsInline loop onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        {mask && shown && <MaskView box={shown} shape={shape} expand={expand} feather={feather} />}
        {trail && (
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
            <polyline points={trail} fill="none" stroke="var(--color-tungsten)" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            {sorted.map((k) => (
              <circle key={k.f} cx={(k.x + k.w / 2) * 1000} cy={(k.y + k.h / 2) * 1000} r={4} fill="var(--color-tungsten)" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        <div
          ref={area}
          className="absolute inset-0 cursor-crosshair touch-none"
          onPointerDown={(e) => {
            video.current?.pause();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const p = pos(e);
            const handle = (e.target as HTMLElement).dataset.handle as Handle | "move" | undefined;
            const at = boxAt(keys, frame);
            if (handle && at) setGesture({ kind: handle, from: at, x0: p.x, y0: p.y, box: at });
            else setGesture({ kind: "draw", x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onPointerMove={(e) => {
            if (!gesture) return;
            const p = pos(e);
            if (gesture.kind === "draw") return setGesture({ ...gesture, x1: p.x, y1: p.y });
            const [dx, dy] = [p.x - gesture.x0, p.y - gesture.y0];
            const box = gesture.kind === "move" ? clampBox({ ...gesture.from, x: gesture.from.x + dx, y: gesture.from.y + dy }) : resize(gesture.from, gesture.kind, dx, dy);
            setGesture({ ...gesture, box });
          }}
          onPointerUp={() => {
            if (gesture && shown) {
              const moved = gesture.kind === "draw" || shown.x !== gesture.from.x || shown.y !== gesture.from.y || shown.w !== gesture.from.w || shown.h !== gesture.from.h;
              if (moved && shown.w > 0.02 && shown.h > 0.02) keyHere(shown);
            }
            setGesture(null);
          }}
        >
          {shown && (
            <div
              data-handle="move"
              className={clsx("absolute cursor-move border-2 border-tungsten", mask ? "bg-transparent" : "bg-tungsten/15")}
              style={{
                left: `${shown.x * 100}%`,
                top: `${shown.y * 100}%`,
                width: `${shown.w * 100}%`,
                height: `${shown.h * 100}%`,
                borderRadius: shape === "ellipse" ? "50%" : 2,
                borderStyle: isKey || gesture ? "solid" : "dashed",
              }}
            />
          )}
          {shown && gesture?.kind !== "draw" && (
            // Handles sit on the box's bounding rectangle, also for an ellipse.
            <div className="pointer-events-none absolute" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }}>
              {HANDLES.map((h) => (
                // A small square to see, inside a bigger area to grab.
                <span
                  key={h.id}
                  data-handle={h.id}
                  className="pointer-events-auto absolute flex size-5 -translate-1/2 items-center justify-center"
                  style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
                >
                  <span className="pointer-events-none size-2.5 rounded-[2px] border border-black/60 bg-tungsten" />
                </span>
              ))}
            </div>
          )}
          {!keys.length && !gesture && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[13px] text-ink/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
              {tr("Drag a box around what you want to replace")}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton label="Previous keyframe (↑)" disabled={!prevKey} onClick={() => prevKey && seek(prevKey.f)}>
          <ChevronFirst size={15} />
        </IconButton>
        <IconButton label="Previous frame (←)" onClick={() => seek(frame - 1)}>
          <StepBack size={14} />
        </IconButton>
        <IconButton label={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => (playing ? video.current?.pause() : video.current?.play())}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </IconButton>
        <IconButton label="Next frame (→)" onClick={() => seek(frame + 1)}>
          <StepForward size={14} />
        </IconButton>
        <IconButton label="Next keyframe (↓)" disabled={!nextKey} onClick={() => nextKey && seek(nextKey.f)}>
          <ChevronLast size={15} />
        </IconButton>

        <div
          ref={bar}
          className="relative mx-2 h-6 flex-1 cursor-pointer touch-none"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).dataset.key) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            seek(frameOf(e.clientX));
          }}
          onPointerMove={(e) => e.buttons === 1 && !dragKey && seek(frameOf(e.clientX))}
          role="slider"
          tabIndex={-1}
          aria-label={tr("Frame")}
          aria-valuemin={0}
          aria-valuemax={frames - 1}
          aria-valuenow={frame}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-raised" />
          <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-tungsten/40" style={{ width: `${(frame / (frames - 1)) * 100}%` }} />
          {keys.length > 1 && (
            <div
              className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-tungsten/70"
              style={{ left: `${(sorted[0].f / (frames - 1)) * 100}%`, width: `${((sorted.at(-1)!.f - sorted[0].f) / (frames - 1)) * 100}%` }}
            />
          )}
          {keys.map((k) => {
            const f = dragKey?.from === k.f ? dragKey.to : k.f;
            return (
              <button
                key={k.f}
                data-key
                title={tr("Keyframe at {time}. Drag to retime.", { time: timecode(f, fps) })}
                aria-label={tr("Keyframe at {time}. Drag to retime.", { time: timecode(f, fps) })}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setDragKey({ from: k.f, to: k.f });
                  seek(k.f);
                }}
                onPointerMove={(e) => {
                  if (dragKey?.from !== k.f) return;
                  const to = frameOf(e.clientX);
                  setDragKey({ from: k.f, to });
                  seek(to);
                }}
                onPointerUp={() => {
                  if (dragKey && dragKey.to !== dragKey.from) commit(retimeKey(keys, dragKey.from, dragKey.to));
                  setDragKey(null);
                }}
                className={clsx("absolute top-1/2 size-3 -translate-1/2 rotate-45 cursor-ew-resize border border-black/50", f === frame ? "bg-ink" : "bg-tungsten")}
                style={{ left: `${(f / (frames - 1)) * 100}%` }}
              />
            );
          })}
          <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-ink" style={{ left: `${(frame / (frames - 1)) * 100}%` }} />
        </div>
        <span className="readout w-16 text-right text-[14px]">{timecode(frame, fps)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[12px]">
        <ToolButton onClick={() => shown && keyHere(shown)} disabled={!shown || isKey} title={tr("Set a keyframe here, holding the box where it is (K)")}>
          <Diamond size={12} /> {tr("Keyframe")}
        </ToolButton>
        <ToolButton onClick={() => commit(keys.filter((k) => k.f !== frame))} disabled={!isKey} title={tr("Delete this keyframe (Delete)")} danger>
          <Trash2 size={12} /> {tr("Delete")}
        </ToolButton>
        <ToolButton onClick={() => setMask((m) => !m)} pressed={mask} title={tr("Show the area the GPU repaints (M)")}>
          {mask ? <EyeOff size={12} /> : <Eye size={12} />} {tr("Mask")}
        </ToolButton>
        <span className="flex-1" />
        <ToolButton onClick={undo} disabled={!history.canUndo} title={tr("Undo (⌘Z)")}>
          <Undo2 size={12} />
        </ToolButton>
        <ToolButton onClick={redo} disabled={!history.canRedo} title={tr("Redo (⇧⌘Z)")}>
          <Redo2 size={12} />
        </ToolButton>
        <ToolButton onClick={() => commit([])} disabled={!keys.length} title={tr("Clear the track")}>
          <Eraser size={12} /> {tr("Clear")}
        </ToolButton>
      </div>
      <p className="text-[12px] text-faint">
        {keys.length === 0
          ? tr("One box is enough for something that stays put.")
          : keys.length === 1
            ? tr("Moves? Go to another moment and move or resize the box; each change sets a keyframe.")
            : tr("{n} keyframes. The dashed line is the box's path; drag the diamonds to retime.", { n: keys.length })}
      </p>
    </div>
  );
}

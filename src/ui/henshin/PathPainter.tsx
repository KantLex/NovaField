"use client";

import { ArrowLeftRight, Eraser, Pause, Play, Redo2, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Asset, PathPoint, PathTiming } from "@/lib/engines/specs";
import { curve, DEFAULT_TIMING, FRAME_MOVES, frameMove, pathAt, simplify, timingOf, type FrameMove } from "@/lib/engines/tracks";
import { tr } from "@/i18n";
import { Segmented } from "../controls";
import { useHotkeys } from "../hotkeys";
import { useHistory } from "../useHistory";
import { clamp01, EASES, Span } from "./PathSpan";

const COLORS = ["#e4ff1a", "#ffffff", "#7cc58f", "#e58fd0", "#9fe0e0", "#ffb46b"];
const MAX_PATHS = 24;
const HISTORY = 60;
type State = { paths: PathPoint[][]; timing: PathTiming[] };
type Gesture =
  | { kind: "draw"; points: PathPoint[]; straight: boolean }
  | { kind: "point"; path: number; point: number }
  | { kind: "path"; path: number; from: PathPoint; base: PathPoint[]; moved: boolean };

/**
 * Drag on the image to draw where things should move; a click pins a thing in place. Each stroke
 * becomes a smooth curve with a few handles: click a path to select it, drag it to move it, drag
 * its handles to reshape it, double-click a handle to remove it or the curve to add one. A selected
 * path has its own timing. Play previews every path's motion over the clip.
 */
export function PathPainter({
  image,
  paths,
  timing,
  onChange,
  ratio,
  seconds,
}: {
  image: Asset;
  paths: PathPoint[][];
  timing: PathTiming[];
  onChange: (paths: PathPoint[][], timing: PathTiming[]) => void;
  ratio: number;
  /** How long the clip runs, for the preview. */
  seconds: number;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  // While dragging a handle or a path, the edit shows live and lands in history once, on release.
  const [draft, setDraft] = useState<PathPoint[][] | null>(null);

  const times = paths.map((_, i) => timingOf(timing, i));
  const shownPaths = draft ?? paths;
  const sel = selected !== null && selected < paths.length ? selected : null;

  const history = useHistory<State>({ paths, timing: times }, (v) => onChange(v.paths, v.timing), HISTORY);
  const commit = history.commit;
  // A selection may point at a path that undo takes away.
  const undo = () => history.undo() && setSelected(null);
  const redo = () => history.redo() && setSelected(null);
  const removePath = (i: number) => {
    commit({ paths: paths.filter((_, j) => j !== i), timing: times.filter((_, j) => j !== i) });
    setSelected(null);
  };
  const setTiming = (i: number, p: Partial<PathTiming>) => commit({ paths, timing: times.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  // Preview: a clock over the clip's length; the dots ride their paths with their own timing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setT((v) => {
        const next = v + (now - last) / 1000 / seconds;
        return next >= 1 ? next - 1 : next;
      });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, seconds]);

  useHotkeys((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (e.key === "Escape") return setSelected(null);
    if (e.key === " ") {
      e.preventDefault();
      return setPlaying((p) => !p);
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel !== null) {
      e.preventDefault();
      removePath(sel);
    }
  });

  const pos = (e: React.PointerEvent | React.MouseEvent): PathPoint => {
    const r = area.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const hit = (e: React.PointerEvent | React.MouseEvent) => {
    const d = (e.target as HTMLElement | SVGElement).dataset ?? {};
    return { path: d.path !== undefined ? Number(d.path) : null, point: d.point !== undefined ? Number(d.point) : null };
  };

  const live = gesture?.kind === "draw" ? gesture.points : null;
  const color = (i: number) => COLORS[i % COLORS.length];

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={area}
        className="relative cursor-crosshair touch-none overflow-hidden rounded-[3px] bg-black select-none"
        style={{ aspectRatio: String(ratio) }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          setPlaying(false);
          const p = pos(e);
          const h = hit(e);
          if (h.path !== null && h.point !== null) {
            setSelected(h.path);
            return setGesture({ kind: "point", path: h.path, point: h.point });
          }
          if (h.path !== null) {
            setSelected(h.path);
            return setGesture({ kind: "path", path: h.path, from: p, base: paths[h.path], moved: false });
          }
          setSelected(null);
          if (paths.length >= MAX_PATHS) return;
          setGesture({ kind: "draw", points: [p], straight: e.shiftKey });
        }}
        onPointerMove={(e) => {
          if (!gesture) return;
          const p = pos(e);
          if (gesture.kind === "draw") {
            // Shift draws a straight line from where the stroke began.
            if (e.shiftKey || gesture.straight) return setGesture({ ...gesture, points: [gesture.points[0], p], straight: true });
            const last = gesture.points[gesture.points.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) > 0.006) setGesture({ ...gesture, points: [...gesture.points, p] });
            return;
          }
          if (gesture.kind === "point") {
            return setDraft(paths.map((q, i) => (i === gesture.path ? q.map((pt, j) => (j === gesture.point ? p : pt)) : q)));
          }
          const [dx, dy] = [p.x - gesture.from.x, p.y - gesture.from.y];
          if (!gesture.moved && Math.hypot(dx, dy) < 0.005) return;
          setGesture({ ...gesture, moved: true });
          setDraft(paths.map((q, i) => (i === gesture.path ? gesture.base.map((pt) => ({ x: clamp01(pt.x + dx), y: clamp01(pt.y + dy) })) : q)));
        }}
        onPointerUp={() => {
          if (gesture?.kind === "draw") {
            const pts = gesture.points;
            const path = pts.length > 1 && Math.hypot(pts.at(-1)!.x - pts[0].x, pts.at(-1)!.y - pts[0].y) > 0.01 ? simplify(pts) : [pts[0]];
            commit({ paths: [...paths, path], timing: [...times, DEFAULT_TIMING] });
            setSelected(paths.length);
          } else if (draft) {
            commit({ paths: draft, timing: times });
          }
          setDraft(null);
          setGesture(null);
        }}
        onDoubleClick={(e) => {
          const h = hit(e);
          if (h.path === null) return;
          const q = paths[h.path];
          if (h.point !== null) {
            // Remove a handle; a path keeps at least its two ends.
            if (q.length > 2) commit({ paths: paths.map((x, i) => (i === h.path ? x.filter((_, j) => j !== h.point) : x)), timing: times });
            return;
          }
          if (q.length < 2) return;
          // Add a handle where the curve was clicked, between the nearest pair of handles.
          const p = pos(e);
          let best = 0;
          let bestD = Infinity;
          for (let j = 0; j < q.length - 1; j++) {
            const m = { x: (q[j].x + q[j + 1].x) / 2, y: (q[j].y + q[j + 1].y) / 2 };
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            if (d < bestD) [best, bestD] = [j, d];
          }
          commit({ paths: paths.map((x, i) => (i === h.path ? [...x.slice(0, best + 1), p, ...x.slice(best + 1)] : x)), timing: times });
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt="Start frame" className="pointer-events-none absolute inset-0 size-full object-cover" draggable={false} />
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
          <defs>
            {COLORS.map((c, i) => (
              <marker key={c} id={`arrow-${i}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={c} />
              </marker>
            ))}
          </defs>
          {shownPaths.map((p, i) => {
            if (p.length < 2) return null;
            const points = curve(p)
              .map((q) => `${q.x * 1000},${q.y * 1000}`)
              .join(" ");
            return (
              <g key={i}>
                {/* A wide invisible stroke, so a thin path is easy to grab. */}
                <polyline data-path={i} points={points} fill="none" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "stroke", cursor: "move" }} />
                <polyline
                  points={points}
                  fill="none"
                  stroke={color(i)}
                  strokeWidth={sel === i ? 4 : 3}
                  strokeOpacity={sel === null || sel === i ? 1 : 0.55}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  markerEnd={`url(#arrow-${i % COLORS.length})`}
                />
              </g>
            );
          })}
          {live && live.length > 1 && (
            <polyline
              points={live.map((q) => `${q.x * 1000},${q.y * 1000}`).join(" ")}
              fill="none"
              stroke={color(paths.length)}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {shownPaths.map((p, i) => (
          <span
            key={`start-${i}`}
            data-path={i}
            className="absolute -translate-1/2 cursor-move rounded-full"
            style={{
              left: `${p[0].x * 100}%`,
              top: `${p[0].y * 100}%`,
              ...(p.length === 1 ? { border: `2.5px solid ${color(i)}`, width: 16, height: 16 } : { background: color(i), width: 12, height: 12 }),
              boxShadow: sel === i ? "0 0 0 2px rgba(0,0,0,0.6)" : undefined,
            }}
          />
        ))}
        {sel !== null &&
          shownPaths[sel]?.length > 1 &&
          shownPaths[sel].map((q, j) => (
            <span
              key={`h-${j}`}
              data-path={sel}
              data-point={j}
              title={tr("Drag to reshape. Double-click to remove.")}
              className="absolute size-3 -translate-1/2 cursor-grab rounded-[3px] border-2 bg-black/70"
              style={{ left: `${q.x * 100}%`, top: `${q.y * 100}%`, borderColor: color(sel) }}
            />
          ))}
        {(playing || t > 0) &&
          paths.map((p, i) => {
            const q = pathAt(p, t, times[i]);
            return (
              <span
                key={`ghost-${i}`}
                className="pointer-events-none absolute size-4 -translate-1/2 rounded-full border-2 border-black/60"
                style={{ left: `${q.x * 100}%`, top: `${q.y * 100}%`, background: color(i) }}
              />
            );
          })}
        {!paths.length && !live && (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[13px] text-ink/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
            {tr("Drag from a thing to where it should go. Click to pin something in place.")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={!paths.length}
          className="rounded p-1 text-ink/85 hover:bg-raised hover:text-ink disabled:opacity-30"
          title={playing ? tr("Pause (Space)") : tr("Preview the motion (Space)")}
          aria-label={playing ? tr("Pause (Space)") : tr("Preview the motion (Space)")}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={t}
          onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))}
          className="h-1 min-w-0 flex-1"
          aria-label={tr("Preview time")}
        />
        <span className="readout w-12 text-right text-[13px] text-ink/85">{(t * seconds).toFixed(1)} s</span>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[12px] text-dim">
        <span className="mr-1">{tr("Move the whole frame")}</span>
        {FRAME_MOVES.map((m) => (
          <button
            key={m.id}
            onClick={() => addFrameMove(m.id)}
            disabled={paths.length + 9 > MAX_PATHS}
            className="rounded-full bg-surround px-2.5 py-1 hover:text-ink disabled:opacity-30"
            title={tr("Adds a grid of paths that move everything together, like a camera move")}
          >
            {tr(m.label)}
          </button>
        ))}
      </div>

      {sel !== null && (
        <div className="flex flex-col gap-2 rounded-md bg-surround px-3 py-2.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="size-3 rounded-full" style={{ background: color(sel) }} />
            <span className="flex-1">{paths[sel].length === 1 ? tr("Pinned point") : tr("Path {n}", { n: sel + 1 })}</span>
            {paths[sel].length > 1 && (
              <button
                onClick={() => commit({ paths: paths.map((p, i) => (i === sel ? [...p].reverse() : p)), timing: times })}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-dim hover:bg-raised hover:text-ink"
                title={tr("Reverse the direction")}
              >
                <ArrowLeftRight size={12} /> {tr("Reverse")}
              </button>
            )}
            <button onClick={() => removePath(sel)} className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-dim hover:bg-raised hover:text-tally" title={tr("Delete (Delete)")}>
              <Trash2 size={12} /> {tr("Delete")}
            </button>
          </div>
          {paths[sel].length > 1 && (
            <>
              <Span value={times[sel]} seconds={seconds} onChange={(p) => setTiming(sel, p)} />
              <Segmented label={tr("Speed")} size="sm" value={times[sel].ease} onChange={(ease) => setTiming(sel, { ease })} options={EASES} />
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-[12px] text-dim">
        <span className="flex-1">
          {paths.length
            ? tr("{moving} moving, {pinned} pinned", { moving: paths.filter((p) => p.length > 1).length, pinned: paths.filter((p) => p.length === 1).length })
            : tr("No paths yet")}
          {paths.length > 0 && sel === null && <span className="text-faint"> · {tr("Click a path to edit it. Shift draws a straight line.")}</span>}
        </span>
        <button onClick={undo} disabled={!history.canUndo} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-raised disabled:opacity-30" title={tr("Undo (⌘Z)")}>
          <Undo2 size={13} /> {tr("Undo")}
        </button>
        <button onClick={redo} disabled={!history.canRedo} className="rounded px-2 py-1 hover:bg-raised disabled:opacity-30" title={tr("Redo (⇧⌘Z)")} aria-label={tr("Redo (⇧⌘Z)")}>
          <Redo2 size={13} />
        </button>
        <button onClick={() => (commit({ paths: [], timing: [] }), setSelected(null))} disabled={!paths.length} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-raised disabled:opacity-30">
          <Eraser size={13} /> {tr("Clear")}
        </button>
      </div>
    </div>
  );

  function addFrameMove(move: FrameMove) {
    const added = frameMove(move);
    commit({ paths: [...paths, ...added], timing: [...times, ...added.map(() => DEFAULT_TIMING)] });
    setSelected(null);
  }
}

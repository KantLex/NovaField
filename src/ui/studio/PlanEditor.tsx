"use client";

import clsx from "clsx";
import { Box, Eye, EyeOff, Plus, Redo2, RotateCcw, Undo2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { propCorners, type CameraPath, type Vec3 } from "@/lib/cinema/camera";
import { forkRig, type CustomRig } from "@/lib/cinema/custom";
import { useHotkeys } from "../hotkeys";
import { Menu, MenuItem } from "../Menu";
import { usePrevis } from "../previs";
import { RigView } from "../RigView";
import { drawPlan } from "./planDraw";
import { addPoint, freeSpot, handles, inProp, legs, MAX_PROPS, removeActor, SET_PIECES, toScreen, toWorld, withCast, type Handle, type View } from "./planGeometry";
import { PlanInspector, SaveMove } from "./PlanInspector";
import { redoRig, undoRig, useRigHistory } from "./rigHistory";
import { tr } from "@/i18n";

/**
 * The floor plan, seen from above. Drag the camera marks (A, B and any points between),
 * their aim dots, and the stand-ins. Editing a preset forks it into a custom rig.
 */
export function PlanEditor({
  path: rawPath,
  rig,
  aspect,
  onEdit,
  onReset,
  onGrab,
}: {
  path: CameraPath;
  rig: CustomRig | null;
  aspect: number;
  /** Receives the edited rig; `rig` is null until the first edit, so callers fork the preset. */
  onEdit: (fn: (r: CustomRig) => CustomRig) => void;
  onReset: () => void;
  /** A drag or nudge is starting: begin a new undo step. */
  onGrab: () => void;
}) {
  const path = withCast(rawPath);
  // Handles edit the rig's marks: the hand-edited keys, or a preset reduced to a few marks.
  // Presets are dense curves; dragging one of dozens of samples would make no sense.
  const marks = useMemo(() => (rig ? rig.keys : forkRig(rawPath).keys), [rig, rawPath]);
  const editable = useMemo<CameraPath>(() => ({ ...path, keys: marks }), [path, marks]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<Handle | null>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const viewRef = useRef<View>({ cx: 0, cz: 1.5, scale: 30 });
  const legInfo = useMemo(() => (marks.length <= 6 ? legs(path, marks) : []), [path, marks]);
  const state = useRef({ path, editable, sel, drag, aspect, legInfo });
  useEffect(() => {
    state.current = { path, editable, sel, drag, aspect, legInfo };
  });
  const inset = usePrevis((s) => s.inset);
  const canUndo = useRigHistory((h) => h.past.length > 0);
  const canRedo = useRigHistory((h) => h.future.length > 0);
  const props = editable.props ?? [];

  // Undo and redo anywhere on the page while the plan is open, except while typing.
  useHotkeys((e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) undoRig();
    else if ((k === "z" && e.shiftKey) || k === "y") redoRig();
    else return;
    e.preventDefault();
  });

  // Frame the plan around everything that matters; re-fit only when not dragging.
  useEffect(() => {
    if (drag) return;
    const c = canvas.current;
    if (!c) return;
    const pts: [number, number][] = [[0, 0]];
    for (const k of editable.keys) pts.push([k.pos[0], k.pos[2]], [k.target[0], k.target[2]]);
    for (const a of path.actors ?? []) pts.push(a.from, a.to);
    for (const pr of path.props ?? []) for (const c of propCorners(pr)) pts.push([c[0], c[2]]);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const pad = 2.2;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minZ = Math.min(...zs) - pad;
    const maxZ = Math.max(...zs) + pad;
    const r = c.getBoundingClientRect();
    // Leave room for the toolbar above and the inspector below.
    const top = 64;
    const bottom = 48;
    const usable = Math.max(80, r.height - top - bottom);
    const scale = Math.max(8, Math.min(90, Math.min(r.width / Math.max(10, maxX - minX), usable / Math.max(6, maxZ - minZ))));
    viewRef.current = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 - (top - bottom) / 2 / scale, scale };
  }, [path, editable, drag]);

  // Draw loop: static plan + the camera and stand-ins playing through the shot.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const r = c.getBoundingClientRect();
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dpr = c.width / Math.max(1, c.getBoundingClientRect().width);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPlan(ctx, c.width / dpr, c.height / dpr, state.current, viewRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const pick = (e: React.PointerEvent): Handle | null => {
    const r = canvas.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    let best: Handle | null = null;
    let bestD = 14;
    // Later handles are drawn on top, so they win ties.
    for (const { h, x, z } of handles(editable)) {
      const [px, py] = toScreen(viewRef.current, x, z, r.width, r.height);
      const d = Math.hypot(px - sx, py - sy);
      if (d <= bestD) {
        best = h;
        bestD = d + 0.01;
      }
    }
    if (best) return best;
    // Set pieces can be grabbed anywhere on their footprint; the top-most wins.
    const [wx, wz] = toWorld(viewRef.current, sx, sy, r.width, r.height);
    for (let i = props.length - 1; i >= 0; i--) if (inProp(props[i], wx, wz)) return { kind: "prop", i };
    return null;
  };

  const moveTo = (h: Handle, x: number, z: number) =>
    onEdit((r) => {
      const keys = r.keys.map((k) => ({ ...k, pos: [...k.pos] as Vec3, target: [...k.target] as Vec3 }));
      const actors = r.actors.map((a) => ({ ...a }));
      if (h.kind === "prop") {
        if (!r.props?.[h.i]) return r;
        return { ...r, props: r.props.map((p, i) => (i === h.i ? { ...p, at: [x, z] as [number, number] } : p)) };
      }
      if ((h.kind === "cam" || h.kind === "aim") && !keys[h.i]) return r;
      if ((h.kind === "from" || h.kind === "to") && !actors[h.i]) return r;
      if (h.kind === "cam") keys[h.i].pos = [x, keys[h.i].pos[1], z];
      else if (h.kind === "aim") keys[h.i].target = [x, keys[h.i].target[1], z];
      else if (h.kind === "from") {
        const walking = actors[h.i].to[0] !== actors[h.i].from[0] || actors[h.i].to[1] !== actors[h.i].from[1];
        const dx = x - actors[h.i].from[0];
        const dz = z - actors[h.i].from[1];
        actors[h.i].from = [x, z];
        // A standing figure moves as one; a walking one keeps its end mark.
        if (!walking) actors[h.i].to = [actors[h.i].to[0] + dx, actors[h.i].to[1] + dz];
      } else actors[h.i].to = [x, z];
      return { ...r, keys, actors };
    });

  /** Delete a set piece, a stand-in or a middle camera point. False when the selection can't go. */
  const removeSelected = (h: Handle): boolean => {
    if (h.kind === "prop") onEdit((r) => ({ ...r, props: (r.props ?? []).filter((_, i) => i !== h.i) }));
    else if (h.kind === "from" || h.kind === "to") onEdit((r) => removeActor(r, h.i));
    else if (h.kind === "cam" && h.i > 0 && h.i < editable.keys.length - 1) onEdit((r) => ({ ...r, keys: r.keys.filter((_, i) => i !== h.i) }));
    else return false;
    return true;
  };

  const addProp = (label: string, size: Vec3) => {
    const n = props.length;
    const at = freeSpot(size, props, editable);
    onGrab();
    onEdit((r) => ({ ...r, props: [...(r.props ?? []), { label, size, at, rot: 0 }].slice(0, MAX_PROPS) }));
    setSel({ kind: "prop", i: n });
  };

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvas}
        tabIndex={0}
        className={clsx("size-full touch-none outline-none", drag ? "cursor-grabbing" : "cursor-default")}
        onPointerDown={(e) => {
          const h = pick(e);
          setSel(h);
          e.currentTarget.focus();
          if (h) {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            onGrab();
            setDrag(h);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") return setSel(null);
          if (!sel) return;
          const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
          const d = arrows[e.key];
          if (d) {
            e.preventDefault();
            const at = handles(editable).find((x) => x.h.kind === sel.kind && x.h.i === sel.i);
            if (!at) return;
            if (!e.repeat) onGrab();
            const step = e.shiftKey ? 0.5 : 0.05;
            moveTo(sel, Math.round((at.x + d[0] * step) * 100) / 100, Math.round((at.z + d[1] * step) * 100) / 100);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onGrab();
            if (removeSelected(sel)) setSel(null);
          }
        }}
        onPointerMove={(e) => {
          const r = canvas.current!.getBoundingClientRect();
          if (!drag) {
            canvas.current!.style.cursor = pick(e) ? "grab" : "default";
            return;
          }
          const [x, z] = toWorld(viewRef.current, e.clientX - r.left, e.clientY - r.top, r.width, r.height);
          moveTo(drag, Math.round(x * 20) / 20, Math.round(z * 20) / 20);
        }}
        onPointerUp={() => setDrag(null)}
        aria-label={tr("Floor plan: drag the camera marks, aim dots, stand-ins and set pieces. Arrow keys nudge the selection, Delete removes it.")}
      />

      <div className="absolute top-9 left-3 flex gap-1">
        <ToolButton
          onClick={() =>
            onEdit((r) =>
              r.actors.length >= 3
                ? r
                : { ...r, actors: [...r.actors, { from: [r.actors.length === 1 ? 1.4 : -1.4, 0.4], to: [r.actors.length === 1 ? 1.4 : -1.4, 0.4], height: 1.75 }] },
            )
          }
          disabled={(path.actors?.length ?? 1) >= 3}
          title={tr("Add a stand-in person")}
        >
          <UserPlus size={13} /> {tr("Stand-in")}
        </ToolButton>
        <ToolButton onClick={() => onEdit(addPoint)} disabled={editable.keys.length >= 6} title={tr("Add a camera point to bend the path")}>
          <Plus size={13} /> {tr("Point")}
        </ToolButton>
        {props.length < MAX_PROPS && (
          <Menu
            label={tr("Add a set piece")}
            trigger={() => (
              <span className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[12px] text-ink/85 backdrop-blur hover:bg-black/80 hover:text-ink">
                <Box size={13} /> {tr("Set piece")}
              </span>
            )}
          >
            {(close) => (
              <>
                <p className="px-2.5 pt-1 pb-1.5 text-[12px] text-faint">{tr("Blocks out the set. The previs renders them, so the shot is framed around them.")}</p>
                {SET_PIECES.map((sp) => (
                  <MenuItem
                    key={sp.label}
                    onClick={() => {
                      close();
                      addProp(sp.label, sp.size);
                    }}
                  >
                    <span className="flex-1">{tr(sp.label)}</span>
                    <span className="readout text-[12px] text-faint">
                      {sp.size[0]} × {sp.size[2]} × {sp.size[1]}m
                    </span>
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        )}
        {rig && (
          <ToolButton
            onClick={() => {
              setSel(null);
              onReset();
            }}
            title={tr("Back to the preset move")}
          >
            <RotateCcw size={13} /> {tr("Reset")}
          </ToolButton>
        )}
        <ToolButton onClick={undoRig} disabled={!canUndo} title={tr("Undo (⌘Z)")} aria-label={tr("Undo")}>
          <Undo2 size={13} />
        </ToolButton>
        <ToolButton onClick={redoRig} disabled={!canRedo} title={tr("Redo (⇧⌘Z)")} aria-label={tr("Redo")}>
          <Redo2 size={13} />
        </ToolButton>
        {rig && <SaveMove rig={rig} />}
      </div>

      {/* What the lens sees right now, so the framing is visible while you block the shot. */}
      <div className="absolute top-2.5 right-3 flex w-[30%] max-w-[260px] min-w-[120px] flex-col items-end gap-1">
        <ToolButton onClick={() => usePrevis.getState().set({ inset: !inset })} title={tr(inset ? "Hide the lens view" : "Show the lens view")}>
          {inset ? <EyeOff size={13} /> : <Eye size={13} />} Lens
        </ToolButton>
        {inset && (
          <div className="pointer-events-none w-full overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_8px_24px_rgba(0,0,0,0.6)]" style={{ aspectRatio: String(aspect) }}>
            <RigView path={rawPath} style="subject" shared className="size-full" />
          </div>
        )}
      </div>

      <PlanInspector sel={sel} path={editable} onEdit={onEdit} onGrab={onGrab} onRemove={() => sel && removeSelected(sel) && setSel(null)} />
    </div>
  );
}

function ToolButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[12px] text-ink/85 backdrop-blur hover:bg-black/80 hover:text-ink disabled:opacity-35">
      {children}
    </button>
  );
}

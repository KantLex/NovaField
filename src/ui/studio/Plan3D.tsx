"use client";

// The plan in 3D: the same rig as the floor plan, orbited instead of seen from above. The scene
// (and three.js) loads when this view first opens; see plan3dScene.ts.

import { Box } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import type { Handle } from "./planGeometry";
import type { Plan3D as Scene, Plan3DHooks } from "./plan3dScene";
import { tr } from "@/i18n";

export function Plan3D({
  path,
  editable,
  sel,
  aspect,
  inset,
  insetRef,
  sceneRef,
  onSelect,
  onGrab,
  onMove,
  onKeyDown,
}: {
  path: CameraPath;
  editable: CameraPath;
  sel: Handle | null;
  aspect: number;
  inset: boolean;
  /** Where the lens view goes: the scene draws through the shot's camera into this box. */
  insetRef: React.RefObject<HTMLDivElement | null>;
  /** The scene, once it's up, for the toolbar's Fit button. */
  sceneRef: React.RefObject<Scene | null>;
  onSelect: (h: Handle | null) => void;
  onGrab: () => void;
  onMove: Plan3DHooks["move"];
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // The scene reads the latest props each frame, and calls back through the latest handlers.
  const state = useRef({ path, editable, sel, aspect, inset });
  const hooks = useRef<Plan3DHooks>({ select: onSelect, grab: onGrab, move: onMove });
  useEffect(() => {
    state.current = { path, editable, sel, aspect, inset };
    hooks.current = { select: onSelect, grab: onGrab, move: onMove };
  });

  useEffect(() => {
    let alive = true;
    let scene: Scene | null = null;
    import("./plan3dScene")
      .then(({ createPlan3D }) => {
        if (!alive) return;
        scene = createPlan3D(
          canvas.current!,
          labels.current!,
          () => state.current,
          () => hooks.current,
          () => insetRef.current,
        );
        sceneRef.current = scene;
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [insetRef, sceneRef]);

  return (
    <div className="absolute inset-0 overflow-hidden" tabIndex={0} onKeyDown={onKeyDown} onPointerDown={(e) => e.currentTarget.focus()}>
      <canvas
        ref={canvas}
        className="size-full touch-none outline-none"
        aria-label={tr("3D plan: drag the camera marks, aims, stand-ins and set pieces across the floor, or a mark up and down with Shift. Drag elsewhere to turn the view, right-drag to pan, scroll to zoom.")}
      />
      <div ref={labels} className="pointer-events-none absolute inset-0" />
      {failed && (
        <p className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-dim">
          <Box size={22} className="text-faint" />
          {tr("The 3D plan needs WebGL, which this browser has switched off. The top view still works.")}
        </p>
      )}
    </div>
  );
}

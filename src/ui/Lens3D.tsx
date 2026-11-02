"use client";

// The monitor's view through the lens, in 3D: the previs set (stand-ins doing their motions, set
// pieces, 3D takes) seen through the shot's camera, on the previs clock. three.js loads with it;
// without WebGL it falls back to the wireframe.

import { useEffect, useRef, useState } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import { lightFromOf } from "@/lib/cinema/looks";
import { RigView } from "./RigView";
import { useStudio } from "./state";

export function Lens3D({ path, onFrame, className }: { path: CameraPath; onFrame?: (frame: number) => void; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  // The studio shot's key light, as the Director panel sets it.
  const light = useStudio((s) => lightFromOf(s.shot));
  const latest = useRef({ path, onFrame, light });
  useEffect(() => {
    latest.current = { path, onFrame, light };
  });

  useEffect(() => {
    if (failed) return;
    let alive = true;
    let lens: { dispose: () => void } | null = null;
    import("./three/lensRender")
      .then(({ createLens }) => {
        if (!alive) return;
        lens = createLens(
          canvas.current!,
          () => latest.current.path,
          (f) => latest.current.onFrame?.(f),
          () => latest.current.light,
        );
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      lens?.dispose();
    };
  }, [failed]);

  if (failed) return <RigView path={path} style="subject" shared onFrame={onFrame} className={className} />;
  return <canvas ref={canvas} className={className} aria-hidden />;
}

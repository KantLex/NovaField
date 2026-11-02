"use client";

// The monitor's view through the lens, in 3D: the previs set (stand-ins doing their motions, set
// pieces, 3D takes) seen through the shot's camera, on the previs clock. three.js loads with it;
// without WebGL it falls back to the wireframe.

import { useEffect, useRef, useState } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import { RigView } from "./RigView";

export function Lens3D({ path, onFrame, className }: { path: CameraPath; onFrame?: (frame: number) => void; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ path, onFrame });
  useEffect(() => {
    latest.current = { path, onFrame };
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

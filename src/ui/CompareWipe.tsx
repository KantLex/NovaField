"use client";

// Before and after on one picture: what a Henshin take was made from, laid over the take and cut
// away at a divider you drag. The source plays in step with the take, so each frame lines up.

import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/jobs";
import { tr } from "@/i18n";

/** What a Henshin take was made from: its source clip, or the still it brought to life. */
export function beforeOf(job: Job): { url: string; kind: "video" | "image" } | null {
  const spec = job.spec as { kind?: string; source?: { url?: string }; image?: { url?: string } } | undefined;
  if (!spec) return null;
  if ((spec.kind === "recast" || spec.kind === "restyle" || spec.kind === "replace") && spec.source?.url) return { url: spec.source.url, kind: "video" };
  if (spec.kind === "paths" && spec.image?.url) return { url: spec.image.url, kind: "image" };
  return null;
}

export function CompareWipe({ video, before }: { video: React.RefObject<HTMLVideoElement | null>; before: { url: string; kind: "video" | "image" } }) {
  const box = useRef<HTMLDivElement>(null);
  const src = useRef<HTMLVideoElement>(null);
  const [x, setX] = useState(0.5);
  const [dragging, setDragging] = useState(false);

  // Follow the take: the same moment, playing or paused with it.
  useEffect(() => {
    if (before.kind !== "video") return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const take = video.current;
      const s = src.current;
      if (!take || !s || s.readyState < 2) return;
      if (take.paused !== s.paused) {
        if (take.paused) s.pause();
        else void s.play().catch(() => {});
      }
      if (Math.abs(s.currentTime - take.currentTime) > 0.08) s.currentTime = take.currentTime;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, before.kind]);

  const place = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setX(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${(1 - x) * 100}% 0 0)` }}>
        {before.kind === "video" ? (
          <video ref={src} src={before.url} className="size-full bg-black object-contain" muted playsInline preload="auto" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={before.url} alt="" className="size-full bg-black object-contain" />
        )}
      </div>
      {/* The divider: dragged anywhere along its height. */}
      <div
        role="slider"
        aria-label={tr("Before and after")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDragging(true);
          place(e.clientX);
        }}
        onPointerMove={(e) => dragging && place(e.clientX)}
        onPointerUp={() => setDragging(false)}
        onKeyDown={(e) => {
          const d = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
          if (!d) return;
          e.preventDefault();
          setX((v) => Math.min(1, Math.max(0, v + d)));
        }}
        className="pointer-events-auto absolute top-0 bottom-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
        style={{ left: `${x * 100}%` }}
      >
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ink shadow-[0_0_6px_rgba(0,0,0,0.8)]" />
        <span className="absolute top-1/2 left-1/2 flex size-7 -translate-1/2 items-center justify-center rounded-full bg-ink text-[13px] font-semibold text-black shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
          ⇔
        </span>
      </div>
      <span className="absolute top-10 rounded bg-black/70 px-1.5 py-0.5 text-[12px] text-ink/90" style={{ right: `calc(${(1 - x) * 100}% + 10px)` }}>
        {tr("Before")}
      </span>
      <span className="absolute top-10 rounded bg-black/70 px-1.5 py-0.5 text-[12px] text-ink/90" style={{ left: `calc(${x * 100}% + 10px)` }}>
        {tr("After")}
      </span>
    </div>
  );
}

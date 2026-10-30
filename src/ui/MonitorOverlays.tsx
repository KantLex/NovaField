"use client";

// What's drawn over the monitor and over takes: framing guides, the camera readout, the previs clip and clock, and a render's progress.

import clsx from "clsx";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import { readoutAt } from "@/lib/cinema/metrics";
import { timecode } from "@/lib/engines/sizing";
import type { Asset } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { previsFrame, usePrevis, usePrevisClock } from "./previs";
import { tr } from "@/i18n";

/** The previs clip a take followed, in the corner and in step with the take. */
export function PrevisPip({ video, src }: { video: React.RefObject<HTMLVideoElement | null>; src: string }) {
  const pip = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = video.current;
      const p = pip.current;
      if (t && p && p.readyState >= 1) {
        const want = p.duration ? t.currentTime % p.duration : t.currentTime;
        if (Math.abs(p.currentTime - want) > 0.12) p.currentTime = want;
        if (t.paused && !p.paused) p.pause();
        else if (!t.paused && p.paused) void p.play().catch(() => {});
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video]);
  return (
    <div className="pointer-events-none absolute right-2 bottom-12 w-[32%] overflow-hidden rounded-[3px] shadow-[0_0_0_1.5px_var(--color-tungsten),0_8px_24px_rgba(0,0,0,0.6)]">
      <video ref={pip} src={src} muted playsInline className="block w-full bg-black" />
      <span className="absolute top-1 left-1 rounded bg-tungsten px-1 text-[10px] font-semibold text-black">{tr("Previs")}</span>
    </div>
  );
}

/** The user's own previs clip on the monitor: looping, click to pause, with the timecode running. */
export function PrevisClip({ clip, dim, tcRef }: { clip: Asset; dim: boolean; tcRef: React.RefObject<HTMLSpanElement | null> }) {
  const fps = clip.fps ?? 24;
  return (
    <>
      <video
        src={clip.url}
        className={clsx("size-full bg-black object-contain transition-[filter] duration-500", dim && "brightness-[0.45] saturate-50")}
        muted
        loop
        autoPlay
        playsInline
        onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause())}
        onTimeUpdate={(e) => {
          if (tcRef.current) tcRef.current.textContent = timecode(Math.floor(e.currentTarget.currentTime * fps), fps);
        }}
      />
      <span className="pointer-events-none absolute bottom-2.5 left-3 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-0.5 text-[12px] text-ink/90 backdrop-blur">
        <span className="size-1.5 rounded-full bg-tungsten" /> {tr("Your previs: the camera follows this clip")}
      </span>
    </>
  );
}

export function PrevisClock({ frames, fps }: { frames: number; fps: number }) {
  usePrevisClock(frames, fps);
  return null;
}

/** Composition guides over the lens view: thirds, and action-safe (93%) and title-safe (90%) boxes. */
export function Guides() {
  const thirds = usePrevis((s) => s.thirds);
  const safe = usePrevis((s) => s.safe);
  if (!thirds && !safe) return null;
  const line = "absolute bg-ink/30";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {thirds && (
        <>
          <span className={clsx(line, "inset-y-0 left-1/3 w-px")} />
          <span className={clsx(line, "inset-y-0 left-2/3 w-px")} />
          <span className={clsx(line, "inset-x-0 top-1/3 h-px")} />
          <span className={clsx(line, "inset-x-0 top-2/3 h-px")} />
        </>
      )}
      {safe && (
        <>
          <span className="absolute inset-[3.5%] border border-dashed border-tungsten/45" />
          <span className="absolute inset-[5%] border border-dashed border-ink/30" />
        </>
      )}
    </div>
  );
}

/** Live camera numbers for the current previs frame: lens, height, distance to the subject, speed. */
export function CameraHud({ path, still }: { path: CameraPath; still?: boolean }) {
  const on = usePrevis((s) => s.hud);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    let last = -1;
    const paint = () => {
      const f = previsFrame(path.frames);
      if (f === last || !ref.current) return;
      last = f;
      const r = readoutAt(path, f);
      const cells = ref.current.children;
      cells[0].textContent = `${Math.round(r.mm)}mm`;
      cells[1].textContent = tr("{v}m high", { v: r.height.toFixed(1) });
      cells[2].textContent = tr("{v}m away", { v: r.distance.toFixed(1) });
      cells[3].textContent = `${r.speed.toFixed(1)}m/s`;
    };
    paint();
    return usePrevis.subscribe(paint);
  }, [on, path]);
  if (!on) return null;
  return (
    <div ref={ref} className="readout pointer-events-none absolute right-3 bottom-2.5 hidden gap-3 sm:flex rounded-md bg-black/55 px-2 py-0.5 text-[13px] text-ink/85 backdrop-blur" aria-label={tr("Camera readout")}>
      <span />
      <span />
      <span />
      <span className={still ? "hidden" : "text-tungsten"} />
    </div>
  );
}

export function FrameLines() {
  // Corner brackets and a centre mark, as on a director's monitor.
  const c = "absolute size-5 border-ink/50";
  return (
    <div className="pointer-events-none absolute inset-[5%]" aria-hidden>
      <span className={clsx(c, "top-0 left-0 border-t border-l")} />
      <span className={clsx(c, "top-0 right-0 border-t border-r")} />
      <span className={clsx(c, "bottom-0 left-0 border-b border-l")} />
      <span className={clsx(c, "right-0 bottom-0 border-r border-b")} />
      <span className="absolute top-1/2 left-1/2 h-3 w-px -translate-1/2 bg-ink/40" />
      <span className="absolute top-1/2 left-1/2 h-px w-3 -translate-1/2 bg-ink/40" />
    </div>
  );
}

export function RenderOverlay({ job }: { job: Job }) {
  const p = job.progress;
  const waiting = job.status === "queued" || job.status === "preparing";
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
      <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 backdrop-blur">
        <span className={clsx("size-2.5 rounded-full", waiting ? "bg-tungsten" : "animate-pulse bg-tally")} />
        <span className="readout text-[14px] tracking-wide">
          {waiting ? (job.ahead ? tr("{n} ahead in the queue", { n: job.ahead }) : tr(p.stage)) : p.steps ? `${tr(p.stage)} ${p.step}/${p.steps}` : tr(p.stage)}
        </span>
      </div>
      <div className="display max-w-[80%] text-center text-[clamp(16px,2.2vw,26px)] text-ink/90">{job.title}</div>
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
        <motion.div className="h-full bg-tally" animate={{ width: `${Math.round(p.pct * 100)}%` }} transition={{ ease: "easeOut", duration: 0.6 }} />
      </div>
    </div>
  );
}

"use client";

// A finished take on screen: its video (with the ghost rig or previs it was made from laid over it), picture or sound.

import clsx from "clsx";
import { Ghost, ImageDown, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { InspectButton, Inspector } from "./Inspector";
import { useEffect, useRef, useState } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import { timecode } from "@/lib/engines/sizing";
import type { Job } from "@/lib/jobs";
import { Menu, MenuItem } from "./Menu";
import { drawFrame } from "./rig";
import { onSeek } from "./Qc";
import { PICTURE_TARGETS, sendTakePicture } from "./sendTo";
import { tr } from "@/i18n";
import { PrevisPip } from "@/ui/MonitorOverlays";

export function TakePlayer({ job, autoPlay = true, onRatio }: { job: Job; autoPlay?: boolean; onRatio?: (ratio: number) => void }) {
  const [inspecting, setInspecting] = useState(false);
  if (!job.video && job.image) {
    return (
      <div className="group absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={job.image}
          alt={job.title}
          onLoad={(e) => e.currentTarget.naturalHeight > 0 && onRatio?.(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          onClick={() => setInspecting(true)}
          className="size-full cursor-zoom-in bg-black object-contain"
        />
        <InspectButton onOpen={() => setInspecting(true)} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" />
        {inspecting && <Inspector job={job} onClose={() => setInspecting(false)} />}
      </div>
    );
  }
  if (!job.video && job.audio) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black p-6">
        <p className="display max-w-[80%] text-center text-[18px] text-ink/85">{job.title}</p>
        <audio src={job.audio} controls autoPlay={autoPlay} className="w-full max-w-md" />
      </div>
    );
  }
  return <VideoTake job={job} autoPlay={autoPlay} onRatio={onRatio} />;
}

export function VideoTake({ job, autoPlay, onRatio }: { job: Job; autoPlay: boolean; onRatio?: (ratio: number) => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const ratioRef = useRef(onRatio);
  useEffect(() => {
    ratioRef.current = onRatio;
  });
  const [playing, setPlaying] = useState(autoPlay);
  const [muted, setMuted] = useState(true);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(job.meta?.seconds ?? 0);
  const [ghost, setGhost] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const fps = job.meta?.fps ?? 24;
  const path = asPath(job.meta?.cameraPath);
  // Shot QC's faults jump the player to where they happen.
  useEffect(
    () =>
      onSeek(job.id, (at) => {
        const el = v.current;
        if (!el) return;
        el.pause();
        setPlaying(false);
        el.currentTime = at;
      }),
    [job.id],
  );
  const previsClip = job.meta?.previs;

  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const onTime = () => setT(el.currentTime);
    const onMeta = () => {
      setDur(el.duration || 0);
      if (el.videoHeight > 0) ratioRef.current?.(el.videoWidth / el.videoHeight);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    if (el.readyState >= 1) onMeta(); // already loaded from cache
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, []);

  const toggle = () => {
    const el = v.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="group absolute inset-0">
      <video
        ref={v}
        src={job.video}
        poster={job.poster}
        className="size-full bg-black object-contain"
        autoPlay={autoPlay}
        muted={muted}
        loop
        playsInline
        onClick={toggle}
      />
      {ghost && path && <GhostOverlay video={v} path={path} />}
      {ghost && previsClip && <PrevisPip video={v} src={previsClip} />}
      {(path || previsClip) && (
        // Always visible (not in the hover bar): the quickest way to check a take against its plan.
        <button
          onClick={() => setGhost((g) => !g)}
          aria-pressed={ghost}
          aria-label={tr("Lay the previs over the take")}
          title={tr(previsClip ? "Your previs beside the take: check the render followed the clip" : "Previs over the take: check the render followed the planned move")}
          className={clsx(
            "absolute top-2 right-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] backdrop-blur transition-colors",
            ghost ? "bg-tungsten font-semibold text-black" : "bg-black/60 text-ink/90 hover:bg-black/80 hover:text-ink",
          )}
        >
          <Ghost size={14} /> {tr("Previs overlay")}
        </button>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button onClick={toggle} className="text-ink" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={dur || 1}
          step={1 / fps}
          value={t}
          onChange={(e) => {
            if (v.current) v.current.currentTime = Number(e.target.value);
          }}
          className="h-1 flex-1"
          aria-label={tr("Scrub")}
        />
        <span className="readout text-[13px] text-ink/80">{timecode(t * fps, fps)}</span>
        {job.status === "done" && (
          <FrameMenu
            job={job}
            onOpen={() => {
              // Hold the frame being sent.
              v.current?.pause();
              setPlaying(false);
            }}
            at={() => v.current?.currentTime ?? 0}
          />
        )}
        <button onClick={() => setMuted((m) => !m)} className="text-ink" aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <InspectButton
          className="bg-transparent p-0 backdrop-blur-none hover:bg-transparent"
          onOpen={() => {
            // One clip playing at a time: the large one takes over.
            v.current?.pause();
            setPlaying(false);
            setInspecting(true);
          }}
        />
      </div>
      {inspecting && <Inspector job={job} onClose={() => setInspecting(false)} />}
    </div>
  );
}

/** "Use this frame": the paused moment as a first or last frame, a cast member or a Henshin still. */
function FrameMenu({ job, at, onOpen }: { job: Job; at: () => number; onOpen: () => void }) {
  const router = useRouter();
  return (
    <span onPointerDown={onOpen} className="flex">
      <Menu
        label={tr("Use this frame")}
        align="right"
        trigger={() => (
          <span className="flex items-center gap-1 text-[12px] text-ink">
            <ImageDown size={16} />
            <span className="hidden sm:inline">{tr("Use this frame")}</span>
          </span>
        )}
      >
        {(close) =>
          PICTURE_TARGETS.map((t) => (
            <MenuItem
              key={t.id}
              onClick={() => {
                close();
                void sendTakePicture(job, t.id, (href) => router.push(href), at());
              }}
            >
              {tr(t.label)}
            </MenuItem>
          ))
        }
      </Menu>
    </span>
  );
}

export const asPath = (p: unknown): CameraPath | null => {
  const c = p as CameraPath | undefined;
  return c && Array.isArray(c.keys) && c.keys.length > 0 && c.frames > 1 ? c : null;
};

/** The planned move's wireframe drawn over the footage, frame for frame, to check the render against the plan. */
export function GhostOverlay({ video, path }: { video: React.RefObject<HTMLVideoElement | null>; path: CameraPath }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const el = video.current;
    if (!c || !el) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dpr = Math.min(2, devicePixelRatio || 1);
      const bw = c.clientWidth;
      const bh = c.clientHeight;
      if (c.width !== Math.round(bw * dpr) || c.height !== Math.round(bh * dpr)) {
        c.width = Math.round(bw * dpr);
        c.height = Math.round(bh * dpr);
        last = "";
      }
      // Match object-contain: draw into the picture's own box, not the letterbox.
      const vr = el.videoWidth && el.videoHeight ? el.videoWidth / el.videoHeight : bw / bh;
      const w = Math.min(bw, bh * vr);
      const h = w / vr;
      const f = Math.min(path.frames - 1, Math.floor(el.currentTime * path.fps));
      const key = `${f}:${c.width}:${c.height}:${w}`;
      if (key === last) return;
      last = key;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, ((bw - w) / 2) * dpr, ((bh - h) / 2) * dpr);
      drawFrame(ctx, w, h, path, f, "subject", false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video, path]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 size-full opacity-80 mix-blend-screen" aria-hidden />;
}

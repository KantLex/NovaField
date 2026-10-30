"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import type { CameraPath } from "@/lib/cinema/camera";
import type { MoveLayer } from "@/lib/cinema/moves";
import { ASPECTS, timecode } from "@/lib/engines/sizing";
import type { Aspect, Asset } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { isLive } from "@/lib/jobs";
import { PrevisTimeline } from "./PrevisTimeline";
import { RigView } from "./RigView";
import { type RigStyle } from "./rig";
import { tr } from "@/i18n";
import { CameraHud, FrameLines, Guides, PrevisClip, PrevisClock, RenderOverlay } from "@/ui/MonitorOverlays";
import { TakePlayer } from "@/ui/TakePlayer";

export interface MonitorReadout {
  left: string[];
  right?: string[];
}

/**
 * The studio monitor. Shows the live previs of the planned camera move; while a take renders
 * it keeps the previs under a tally; when the take lands it cuts to the footage.
 */
export function Monitor({
  aspect,
  path,
  rigStyle = "subject",
  job,
  readout,
  tone = "tungsten",
  plan,
  previs,
  clip,
  still,
  children,
}: {
  aspect: Aspect;
  path?: CameraPath;
  rigStyle?: RigStyle;
  job?: Job | null;
  readout: MonitorReadout;
  tone?: "tungsten" | "daylight";
  /** Editable floor plan, shown in the "Plan" view. */
  plan?: React.ReactNode;
  /** What the previs timeline shows: the combined moves and custom marks, and the name for saved previs. */
  /** The engine makes a still image: frame the picture, no timeline. */
  still?: boolean;
  previs?: { layers?: MoveLayer[] | null; marks?: number[]; label: string; onMarkTime?: (i: number, t: number) => void };
  /** The user's own previs clip: it plays in place of the wireframe previs. */
  clip?: Asset;
  children?: React.ReactNode;
}) {
  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? 16 / 9;
  const [view, setView] = useState<"camera" | "plan">("camera");
  const tcRef = useRef<HTMLSpanElement>(null);
  const live = job && isLive(job);
  const showTake = job?.status === "done" && (job.video || job.image || job.audio);
  const clipMode = !!clip && !showTake;
  const showPrevis = !!path && !showTake && !clip;
  const planView = view === "plan" && !!plan && !live;
  // A finished take is framed at its own shape, not the format picked since (or ignored by its engine).
  const [mediaRatio, setMediaRatio] = useState<{ id: string; ratio: number } | null>(null);
  const metaRatio = job?.meta && job.meta.width > 0 && job.meta.height > 0 ? job.meta.width / job.meta.height : null;
  const frameRatio = showTake ? (mediaRatio?.id === job.id ? mediaRatio.ratio : (metaRatio ?? ratio)) : ratio;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-[3px] bg-monitor p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" data-tone={tone}>
      <div className="relative flex h-[56vw] max-h-[68vh] min-h-[240px] flex-none items-center justify-center overflow-hidden [container-type:size] lg:h-[38vw] xl:h-auto xl:max-h-none xl:flex-1">
        <div className="relative" style={{ aspectRatio: String(frameRatio), width: `min(100cqw, calc(100cqh * ${frameRatio}))` }}>
          <AnimatePresence mode="popLayout" initial={false}>
            {showTake ? (
              <motion.div key={`take-${job.id}`} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TakePlayer job={job} onRatio={(r) => setMediaRatio({ id: job.id, ratio: r })} />
                <motion.div className="pointer-events-none absolute inset-0 bg-white" initial={{ opacity: 0.85 }} animate={{ opacity: 0 }} transition={{ duration: 0.35 }} />
              </motion.div>
            ) : clipMode ? (
              <motion.div key={`clip-${clip.url}`} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <PrevisClip clip={clip} dim={!!live} tcRef={tcRef} />
                <FrameLines />
                <Guides />
              </motion.div>
            ) : path && view === "plan" && plan && !live ? (
              <motion.div key="plan" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {plan}
              </motion.div>
            ) : path ? (
              <motion.div key="previs" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <RigView
                  path={path}
                  style={rigStyle}
                  shared
                  view={view === "plan" ? "overview" : "camera"}
                  className={clsx("size-full transition-[filter] duration-500", live && "brightness-[0.45] saturate-50")}
                  onFrame={(f) => {
                    if (tcRef.current) tcRef.current.textContent = timecode(f, path.fps);
                  }}
                />
                <FrameLines />
                {view === "camera" && <Guides />}
              </motion.div>
            ) : (
              <div key="empty" className="absolute inset-0">
                {children}
              </div>
            )}
          </AnimatePresence>

          {showPrevis && view === "camera" && !live && <CameraHud path={path} still={still} />}

          {!showTake && !planView && (
            <div className="pointer-events-none absolute inset-x-3 top-2.5 flex items-start justify-between gap-4 text-[12px]">
              <div className="readout flex flex-wrap gap-x-3 text-[13px] text-ink/85">
                {readout.left.map((r) => (
                  <span key={r}>{r}</span>
                ))}
              </div>
              <div className="readout flex gap-3 text-[13px] text-ink/70">
                {readout.right?.map((r) => (
                  <span key={r}>{r}</span>
                ))}
                {(path || clipMode) && <span ref={tcRef}>00:00:00</span>}
              </div>
            </div>
          )}

          {live && job && <RenderOverlay job={job} />}

          {path && !showTake && !clip && (
            <div className={clsx("absolute left-3 flex gap-1 rounded-md bg-black/55 p-0.5 text-[12px] backdrop-blur", planView ? "top-2.5" : "bottom-2.5")}>
              {(["camera", "plan"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={clsx("rounded px-2 py-0.5", view === v ? "bg-white/15 text-ink" : "text-ink/60 hover:text-ink")}
                >
                  {tr(v === "camera" ? "Through the lens" : plan ? "Plan" : "Bird's eye")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {showPrevis && !still && (
        <>
          <PrevisClock frames={path.frames} fps={path.fps} />
          <PrevisTimeline
            path={path}
            layers={previs?.layers}
            marks={previs?.marks}
            onMarkTime={previs?.onMarkTime}
            style={rigStyle}
            ratio={ratio}
            label={previs?.label ?? "Shot"}
          />
        </>
      )}
    </div>
  );
}

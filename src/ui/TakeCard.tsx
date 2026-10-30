"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { AudioLines, Check, Clapperboard, Film, Image as ImageIcon, Pencil, Star, Workflow, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useEffect, useState } from "react";
import { KIND_LABEL } from "@/lib/engines/specs";
import { isLive, outputOf, type Job } from "@/lib/jobs";
import { api, fail } from "./api";
import { startTakeDrag } from "./dragTakes";
import { TakePlayer } from "./TakePlayer";
import { QcBadge } from "./Qc";
import { canEditAsWorkflow, editAsWorkflow, TakeActions } from "./TakeActions";
import { intlLocale, tr } from "@/i18n";

export type TakeFilter = "all" | "video" | "image" | "shots" | "henshin" | "workflows" | "starred";

export const TAKE_FILTERS: { id: TakeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "image", label: "Image" },
  { id: "shots", label: "Studio" },
  { id: "henshin", label: "Henshin" },
  { id: "workflows", label: "Workflows" },
  { id: "starred", label: "Starred" },
];

export function matchesFilter(j: Job, f: TakeFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "video":
    case "image":
      return outputOf(j) === f;
    case "shots":
      return j.kind === "shot";
    case "henshin":
      return j.kind !== "shot" && j.kind !== "workflow" && j.kind !== "image" && j.kind !== "grade";
    case "workflows":
      return j.kind === "workflow";
    case "starred":
      return !!j.favorite;
  }
}

/** Takes grouped by the day they were made, newest first. */
export function byDay(list: Job[]) {
  const out: { day: string; jobs: Job[] }[] = [];
  for (const j of [...list].sort((a, b) => b.createdAt - a.createdAt)) {
    const day = new Date(j.createdAt).toLocaleDateString(intlLocale(), { weekday: "long", month: "long", day: "numeric" });
    if (out[out.length - 1]?.day !== day) out.push({ day, jobs: [] });
    out[out.length - 1].jobs.push(j);
  }
  return out;
}

const OUTPUT_TAG = {
  video: { label: "Video", icon: Film, tone: "bg-tungsten text-black" },
  image: { label: "Image", icon: ImageIcon, tone: "bg-ink text-surround" },
  audio: { label: "Audio", icon: AudioLines, tone: "bg-daylight text-black" },
} as const;

/** The corner tag on a take: Video, Image or Audio for shots and workflows; the Henshin tool otherwise. */
export function KindTag({ job, small }: { job: Job; small?: boolean }) {
  const out = job.kind === "shot" || job.kind === "workflow" || job.kind === "image" || job.kind === "grade" ? outputOf(job) : null;
  const tag = out ? OUTPUT_TAG[out] : null;
  const Icon = tag?.icon;
  return (
    <span
      className={clsx(
        "absolute flex items-center gap-1 rounded font-semibold",
        small ? "top-1 left-1 px-1 text-[10px]" : "top-1.5 left-1.5 px-1.5 text-[11px]",
        tag ? tag.tone : job.kind === "workflow" ? "bg-ink text-surround" : "bg-tungsten text-black",
      )}
    >
      {Icon && <Icon size={small ? 10 : 11} strokeWidth={2.5} aria-hidden />}
      {tr(tag ? tag.label : KIND_LABEL[job.kind])}
    </span>
  );
}

/** A take's poster; hovering slides through its contact strip (10 frames across the take). */
export function ScrubFrame({ job, icon = 20 }: { job: Job; icon?: number }) {
  const [scrub, setScrub] = useState<number | null>(null);
  return (
    <span
      className="absolute inset-0"
      onMouseMove={(e) => {
        if (!job.strip) return;
        const r = e.currentTarget.getBoundingClientRect();
        setScrub(Math.min(9, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 10))));
      }}
      onMouseLeave={() => setScrub(null)}
    >
      {scrub !== null && job.strip ? (
        <span
          className="absolute inset-0 bg-no-repeat"
          style={{ backgroundImage: `url(${job.strip})`, backgroundSize: "1000% 100%", backgroundPositionX: `${(scrub / 9) * 100}%` }}
        />
      ) : job.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={job.poster} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-faint">
          <Clapperboard size={icon} />
        </span>
      )}
      {scrub !== null && job.strip && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/20">
          <span className="block h-full bg-ink" style={{ width: `${((scrub + 1) / 10) * 100}%` }} />
        </span>
      )}
    </span>
  );
}

/** A take as a card: hover to scrub, click to open (or to select in select mode). */
/** One take in a grid. Memoised: a render's progress re-draws only its own card, not the whole library. */
export const TakeCard = memo(function TakeCard({
  job,
  onOpen,
  selecting,
  selected,
  onSelect,
  dragIds,
}: {
  job: Job;
  /** Handlers take the take's id, so one stable function serves every card. */
  onOpen: (id: string) => void;
  selecting?: boolean;
  selected?: boolean;
  onSelect?: (id: string, on: boolean) => void;
  /** Makes the card draggable onto a project; returns the takes it carries (the selection, if it's part of one). */
  dragIds?: (id: string) => string[];
}) {
  const live = isLive(job);
  const [dragging, setDragging] = useState(false);
  return (
    <article
      data-take={job.id}
      className={clsx("group flex flex-col gap-1.5 transition-opacity", dragging && "opacity-40")}
      draggable={!!dragIds}
      onDragStart={(e) => {
        if (!dragIds) return;
        startTakeDrag(e, dragIds(job.id), job.poster ?? job.image);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      <div className="relative">
        <button
          onClick={() => (selecting ? onSelect?.(job.id, !selected) : onOpen(job.id))}
          className={clsx(
            "relative block aspect-video w-full overflow-hidden rounded-[3px] bg-black transition-shadow",
            selected ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_rgba(255,255,255,0.06)]",
          )}
          aria-label={tr(selecting ? (selected ? "Deselect {name}" : "Select {name}") : "Open {name}", { name: job.title })}
          aria-pressed={selecting ? !!selected : undefined}
        >
          <ScrubFrame job={job} />
          {live && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
              <span className="flex items-center gap-1.5 text-[12px]">
                <span className={clsx("size-2 rounded-full", job.status === "running" ? "animate-pulse bg-tally" : "bg-tungsten")} />
                {tr(job.progress.stage)}
              </span>
              <span className="h-[2px] w-1/2 bg-white/15">
                <span className="block h-full bg-tally transition-[width]" style={{ width: `${job.progress.pct * 100}%` }} />
              </span>
            </span>
          )}
          {job.status === "failed" && <span className="absolute inset-0 flex items-center justify-center bg-tally/25 text-[13px] font-semibold">{tr("Failed")}</span>}
        </button>
        <KindTag job={job} />
        <QcBadge job={job} />
        {selecting ? (
          <span
            className={clsx(
              "pointer-events-none absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full border-2",
              selected ? "border-tungsten bg-tungsten text-black" : "border-white/70 bg-black/40",
            )}
          >
            {selected && <Check size={12} strokeWidth={3} />}
          </span>
        ) : (
          // Thumbnails stay light: sequence and graph mode live in the Studio and the viewer's details.
          <TakeActions job={job} without={["graph", "previs"]} />
        )}
      </div>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-snug" title={job.title}>
          {job.title}
        </p>
        {job.favorite && <Star size={13} className="mt-0.5 shrink-0 fill-tungsten text-tungsten" />}
      </div>
      <p className="readout text-[13px] text-faint">
        {job.meta ? `${job.meta.width}×${job.meta.height}, ${job.meta.seconds.toFixed(1)} s` : ""}
        {job.status === "done" && job.startedAt && job.finishedAt ? `, ${tr("rendered in {time}", { time: fmtDuration(job.finishedAt - job.startedAt) })}` : ""}
      </p>
    </article>
  );
});


export function TakeViewer({ job, onClose }: { job: Job; onClose: () => void }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const seed = "seed" in job.spec ? job.spec.seed : null;
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={job.title}
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="grid max-h-full w-full max-w-[1280px] gap-4 overflow-auto rounded-md bg-panel p-3 lg:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="relative overflow-hidden rounded-[3px] bg-black" style={{ aspectRatio: `${job.meta?.width ?? 16}/${job.meta?.height ?? 9}` }}>
          {job.status === "done" ? <TakePlayer job={job} /> : <div className="flex size-full items-center justify-center text-[14px] text-dim">{tr(job.error ?? job.progress.stage)}</div>}
        </div>
        <div className="flex flex-col gap-4 p-1">
          <div className="flex items-start gap-3">
            <TakeTitle job={job} />
            <button onClick={onClose} aria-label={tr("Close")} className="rounded p-1 text-dim hover:bg-raised hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <TakeActions job={job} inline without={["graph"]} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-dim">{tr("Model")}</dt>
            <dd className="flex items-start justify-between gap-2">
              <span>{job.meta?.engine ?? tr("Not compiled")}</span>
              {canEditAsWorkflow(job) && (
                <button
                  onClick={() => void editAsWorkflow(job, router.push)}
                  className="flex shrink-0 items-center gap-1 rounded bg-raised px-2 py-0.5 text-[12px] text-dim hover:bg-hover hover:text-ink"
                  title={tr("Edit as workflow (graph mode)")}
                >
                  <Workflow size={12} /> {tr("Graph mode")}
                </button>
              )}
            </dd>
            {job.meta && (
              <>
                <dt className="text-dim">{tr("Frame")}</dt>
                <dd className="readout text-[14px]">
                  {job.meta.width}×{job.meta.height}, {job.meta.fps} fps, {job.meta.seconds.toFixed(2)} s
                </dd>
              </>
            )}
            {seed !== null && (
              <>
                <dt className="text-dim">{tr("Seed")}</dt>
                <dd className="readout text-[14px]">{seed}</dd>
              </>
            )}
            {job.startedAt && job.finishedAt && (
              <>
                <dt className="text-dim">{tr("Render")}</dt>
                <dd>{fmtDuration(job.finishedAt - job.startedAt)}</dd>
              </>
            )}
            {job.dryRun && (
              <>
                <dt className="text-dim">{tr("Mode")}</dt>
                <dd>{tr("Dry run (placeholder footage)")}</dd>
              </>
            )}
          </dl>
          {job.error && <p className="rounded-md bg-tally/10 p-2.5 text-[13px] whitespace-pre-line text-tally">{tr(job.error)}</p>}
          {job.meta?.notes.map((n) => (
            <p key={n} className="text-[12px] text-tungsten">
              {tr(n)}
            </p>
          ))}
          {job.meta?.prompt && (
            <div className="flex flex-col gap-1">
              <h3 className="text-[13px] font-semibold text-dim">{tr("What the model read")}</h3>
              <p className="max-h-56 overflow-auto rounded-md bg-surround p-2.5 text-[13px] leading-relaxed text-ink/85">{job.meta.prompt}</p>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 90 ? tr("{s} s", { s }) : tr("{m} min {s} s", { m: Math.floor(s / 60), s: s % 60 });
}

/** The take's name; click it (or the pencil) to rename. Enter saves, Escape cancels. */
function TakeTitle({ job }: { job: Job }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    const name = draft?.replace(/\s+/g, " ").trim();
    setDraft(null);
    if (name && name !== job.title) api.rename(job.id, name).catch(fail);
  };
  if (draft !== null)
    return (
      <input
        autoFocus
        value={draft}
        maxLength={200}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            // Cancel the edit only, not the viewer.
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setDraft(null);
          }
        }}
        aria-label={tr("Take name")}
        className="display min-w-0 flex-1 rounded bg-surround px-1.5 py-0.5 text-[19px] leading-snug"
      />
    );
  return (
    <h2 className="display group/title min-w-0 flex-1 text-[19px] leading-snug">
      <button onClick={() => setDraft(job.title)} className="text-left hover:text-tungsten" title={tr("Rename")}>
        {job.title}
        <Pencil size={13} className="ml-1.5 inline align-baseline text-dim opacity-0 transition-opacity group-hover/title:opacity-100" aria-hidden />
      </button>
    </h2>
  );
}

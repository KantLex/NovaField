"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ChevronUp, Star } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { JobKind } from "@/lib/engines/specs";
import { isLive, outputOf, type Job } from "@/lib/jobs";
import { inView, projectName, useProjects } from "./projects";
import { useLive } from "./state";
import { startTakeDrag } from "./dragTakes";
import { TakeActions } from "./TakeActions";
import { QcBadge } from "./Qc";
import { KindTag, ScrubFrame } from "./TakeCard";
import { TakeDrawer } from "./TakeDrawer";
import { tr } from "@/i18n";
import { useEvent } from "./useEvent";

/**
 * Recent takes in the current project, as a strip of film. Click a frame to put it on the
 * monitor; click the film's edge (or Show all) to open every take in a drawer.
 */
export function TakeStrip({ kinds, pictures, empty }: { kinds?: JobKind[]; /** Only takes that are pictures, of any kind. */ pictures?: boolean; empty: string }) {
  const jobs = useLive((s) => s.jobs);
  const focus = useLive((s) => s.focus);
  const setFocus = useLive((s) => s.setFocus);
  const current = useProjects((s) => s.current);
  const projects = useProjects((s) => s.list);
  const [drawer, setDrawer] = useState(false);
  const all = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => (!kinds || kinds.includes(j.kind)) && (!pictures || outputOf(j) === "image") && inView(j, current))
        .sort((a, b) => b.createdAt - a.createdAt),
    [jobs, kinds, pictures, current],
  );
  const list = all.slice(0, 40);
  const expand = () => setDrawer(true);
  const toggleFocus = useEvent((id: string) => setFocus(useLive.getState().focus === id ? null : id));

  return (
    <>
      <div className="rounded-md bg-[#141414] px-2 pt-1 pb-1.5">
        <div className="flex items-center gap-2 px-1 pb-0.5 text-[12px]">
          <span className="text-dim">{tr(projectName(current, projects))}</span>
          <span className="readout text-[13px] text-faint">{all.length === 1 ? tr("1 take") : tr("{n} takes", { n: all.length })}</span>
          <button onClick={expand} className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Show all takes")}>
            <ChevronUp size={13} /> {tr("Show all")}
          </button>
        </div>
        <button onClick={expand} className="sprockets block h-2 w-full cursor-n-resize opacity-70 hover:opacity-100" aria-label={tr("Show all takes")} tabIndex={-1} />
        <div className="flex min-h-[104px] gap-2 overflow-x-auto py-1.5">
          {list.length === 0 && <p className="self-center px-3 text-[13px] text-faint">{empty}</p>}
          <AnimatePresence initial={false}>
            {list.map((j, i) => (
              <StripItem key={j.id} job={j} index={i} active={focus === j.id} onFocus={toggleFocus} />
            ))}
          </AnimatePresence>
          {all.length > list.length && (
            <button onClick={expand} className="flex w-[120px] shrink-0 flex-col items-center justify-center gap-1 rounded-[3px] border border-dashed border-line text-[12px] text-dim hover:border-dim hover:text-ink">
              <span className="readout text-[18px] text-ink">+{all.length - list.length}</span>
              {tr("more takes")}
            </button>
          )}
        </div>
        <button onClick={expand} className="sprockets block h-2 w-full cursor-n-resize opacity-70 hover:opacity-100" aria-label={tr("Show all takes")} tabIndex={-1} />
      </div>
      <TakeDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        kinds={kinds}
        onPick={(id) => {
          setFocus(id);
          setDrawer(false);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </>
  );
}

/**
 * One frame of the strip, memoised: a render's progress re-draws only its own frame. `index` is
 * passed so a new take arriving re-renders the rest, which lets them slide along.
 */
const StripItem = memo(function StripItem({ job, active, onFocus }: { job: Job; index: number; active: boolean; onFocus: (id: string) => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
      <TakeFrame job={job} active={active} onFocus={() => onFocus(job.id)} />
    </motion.div>
  );
});

// Takes seen rendering in this tab: when one finishes, its frame glows once.
const watched = new Set<string>();

function TakeFrame({ job, active, onFocus }: { job: Job; active: boolean; onFocus: () => void }) {
  const live = isLive(job);
  if (live) watched.add(job.id);
  const landed = job.status === "done" && watched.has(job.id);
  const tone = job.kind === "workflow" ? "ink" : "tungsten";
  return (
    <div
      data-take={job.id}
      className="group w-[164px] shrink-0"
      // Finished takes drag onto the frame slots, the cast, the previs slot and workflow inputs.
      draggable={job.status === "done"}
      onDragStart={(e) => startTakeDrag(e, [job.id], job.poster ?? job.image)}
    >
      <div className="relative">
      <button
        onClick={onFocus}
        className={clsx(
          "relative block aspect-video w-full overflow-hidden rounded-[3px] bg-black transition-shadow",
          active
            ? tone === "tungsten"
              ? "shadow-[0_0_0_2px_var(--color-tungsten)]"
              : "shadow-[0_0_0_2px_var(--color-ink)]"
            : "shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
        )}
        aria-label={tr("Show {name} on the monitor", { name: job.title })}
      >
        <ScrubFrame job={job} icon={18} />
        {live && (
          <span className="absolute inset-0 flex flex-col justify-end bg-black/55 p-1.5 text-left">
            <span className="flex items-center gap-1.5 text-[11px]">
              <span className={clsx("size-1.5 rounded-full", job.status === "running" ? "animate-pulse bg-tally" : "bg-tungsten")} />
              <span className="truncate">{job.status === "queued" && job.ahead ? tr("{n} ahead", { n: job.ahead }) : tr(job.progress.stage)}</span>
            </span>
            <span className="mt-1 h-[2px] w-full bg-white/15">
              <span className="block h-full bg-tally transition-[width] duration-500" style={{ width: `${Math.round(job.progress.pct * 100)}%` }} />
            </span>
          </span>
        )}
        {job.status === "failed" && <span className="absolute inset-0 flex items-center justify-center bg-tally/25 text-[12px] font-semibold">{tr("Failed")}</span>}
        {job.status === "cancelled" && <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[12px] text-dim">{tr("Cancelled")}</span>}
        {job.favorite && <Star size={12} className="absolute top-1 right-1 fill-tungsten text-tungsten" />}
        <KindTag job={job} small />
        <QcBadge job={job} small />
        {landed && <span className="pointer-events-none absolute inset-0 animate-[nf-flash_1.2s_ease-out] rounded-[3px]" aria-hidden />}
      </button>
      {/* Kept to one row: graph mode, "use as previs" and renaming live in the viewer and under the monitor. */}
      <TakeActions job={job} without={["graph", "previs", "rename"]} />
      </div>
      <p className="mt-1 truncate text-[12px] text-dim" title={job.error ? tr(job.error) : job.title}>
        {job.title}
      </p>
    </div>
  );
}

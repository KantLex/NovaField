"use client";

import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { CheckSquare, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { JobKind } from "@/lib/engines/specs";
import { MoveToProject } from "./ProjectMenu";
import { inView, projectName, useProjects } from "./projects";
import { useLive } from "./state";
import { byDay, matchesFilter, TAKE_FILTERS, TakeCard, TakeViewer, type TakeFilter } from "./TakeCard";
import { tr } from "@/i18n";
import { useReveal } from "./reveal";
import { useEvent } from "./useEvent";

const defaultFilter = (kinds?: JobKind[]): TakeFilter =>
  !kinds ? "all" : kinds.every((k) => k === "shot") ? "shots" : kinds.every((k) => k === "workflow") ? "workflows" : "henshin";

/**
 * Every take in the current project, as big scrubbable cards. Picking a take of this page's
 * kind puts it on the monitor; anything else opens in the viewer.
 */
export function TakeDrawer({ open, onClose, kinds, onPick }: { open: boolean; onClose: () => void; kinds?: JobKind[]; onPick: (id: string) => void }) {
  const jobs = useLive((s) => s.jobs);
  const current = useProjects((s) => s.current);
  const projects = useProjects((s) => s.list);
  const [filter, setFilter] = useState<TakeFilter>(defaultFilter(kinds));
  const reveal = useReveal(filter);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewer, setViewer] = useState<string | null>(null);
  // One handler for every card, so a render's progress re-draws only its own card.
  const toggle = useEvent((id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    }),
  );
  const openTake = useEvent((id: string) => (jobs[id] && kinds?.includes(jobs[id].kind) ? onPick(id) : setViewer(id)));

  const list = useMemo(() => Object.values(jobs).filter((j) => inView(j, current) && matchesFilter(j, filter)), [jobs, current, filter]);
  const groups = useMemo(() => byDay(list), [list]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !viewer && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, viewer, onClose]);

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} aria-label={tr("Close all takes")} tabIndex={-1} />
            <motion.section
              role="dialog"
              aria-modal
              aria-label={tr("All takes")}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className="absolute inset-x-0 bottom-0 flex max-h-[86dvh] min-h-[50dvh] flex-col rounded-t-xl border-t border-line bg-panel"
            >
              <div className="sprockets mx-3 mt-2 h-2 opacity-50" aria-hidden />
              <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-2 pb-3 sm:px-6">
                <div className="min-w-0">
                  <h2 className="display text-[20px] leading-tight">{tr(projectName(current, projects))}</h2>
                  <p className="readout text-[13px] text-faint">
                    {list.length} take{list.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div role="tablist" aria-label={tr("Filter takes")} className="flex flex-wrap gap-1">
                  {TAKE_FILTERS.map((f) => (
                    <button
                      key={f.id}
                      role="tab"
                      aria-selected={filter === f.id}
                      onClick={() => setFilter(f.id)}
                      className={clsx("rounded-full px-2.5 py-1 text-[12px]", filter === f.id ? "bg-tungsten text-black" : "bg-surround text-dim hover:text-ink")}
                    >
                      {tr(f.label)}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {selecting ? (
                    <>
                      <span className="readout text-[14px] text-ink">{selected.size} selected</span>
                      {selected.size > 0 && <MoveToProject ids={[...selected]} onMoved={stopSelecting} />}
                      <button onClick={stopSelecting} className="rounded-md px-2.5 py-1.5 text-[13px] text-dim hover:bg-raised hover:text-ink">
                        {tr("Done")}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => setSelecting(true)} className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
                      <CheckSquare size={14} /> {tr("Select")}
                    </button>
                  )}
                  <button onClick={onClose} className="rounded-md p-1.5 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Close")}>
                    <X size={18} />
                  </button>
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
                {list.length === 0 && <p className="py-10 text-center text-[14px] text-faint">{tr("No takes here yet.")}</p>}
                {groups.map((g) => (
                  <section key={g.day} className="mb-6 flex flex-col gap-3">
                    <h3 className="text-[13px] font-semibold text-dim">{g.day}</h3>
                    <div key={reveal.key} className={clsx("grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-3 gap-y-5", reveal.className)}>
                      {g.jobs.map((j) => (
                        <TakeCard
                          key={j.id}
                          job={j}
                          selecting={selecting}
                          selected={selected.has(j.id)}
                          onSelect={toggle}
                          onOpen={openTake}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{viewer && jobs[viewer] && <TakeViewer job={jobs[viewer]} onClose={() => setViewer(null)} />}</AnimatePresence>
    </>
  );
}

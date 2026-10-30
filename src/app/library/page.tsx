"use client";

import clsx from "clsx";
import { AnimatePresence } from "motion/react";
import { CheckSquare, Clapperboard, Folder, Inbox, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { UNSORTED, type Project } from "@/lib/projects";
import { fail, toast } from "@/ui/api";
import { Segmented } from "@/ui/controls";
import { Menu, MenuItem } from "@/ui/Menu";
import { MoveToProject, NewProject } from "@/ui/ProjectMenu";
import { inView, projectName, useProjects } from "@/ui/projects";
import { useLive } from "@/ui/state";
import { isTakeDrag, takesFrom } from "@/ui/dragTakes";
import { usePulse } from "@/ui/pulse";
import { byDay, matchesFilter, TAKE_FILTERS, TakeCard, TakeViewer, type TakeFilter } from "@/ui/TakeCard";
import { columnWidth, SidePanel, usePanelKeys, usePanelOpen } from "@/ui/SidePanel";
import { tr } from "@/i18n";
import { useReveal } from "@/ui/reveal";
import { useEvent } from "@/ui/useEvent";

export default function LibraryPage() {
  const jobs = useLive((s) => s.jobs);
  const { list: projects, current, setCurrent, move } = useProjects();
  const [filter, setFilter] = useState<TakeFilter>("all");
  const reveal = useReveal(filter);
  const [open, setOpen] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // One handler for every card, so a render's progress re-draws only its own card.
  const toggle = useEvent((id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    }),
  );

  const list = useMemo(() => Object.values(jobs).filter((j) => inView(j, current) && matchesFilter(j, filter)), [jobs, current, filter]);
  const groups = useMemo(() => byDay(list), [list]);
  // Only takes on screen count as selected: another project or filter hides the rest, and Move must not touch them.
  const picked = useMemo(() => list.filter((j) => selected.has(j.id)).map((j) => j.id), [list, selected]);
  const dragFor = useEvent((id: string) => (selecting && selected.has(id) ? picked : [id]));
  const count = (view: string | null) => Object.values(jobs).filter((j) => inView(j, view)).length;
  const viewing = open ? jobs[open] : null;
  const projectsOpen = usePanelOpen("library-projects");
  usePanelKeys({ left: "library-projects" });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  // Dropping takes on a project moves them there; the selection travels together.
  const dropInto = (project: string | null) => async (ids: string[]) => {
    const moving = ids.filter((id) => jobs[id] && (jobs[id].project ?? null) !== project);
    if (!moving.length) return;
    try {
      await move(moving, project);
      toast(
        moving.length > 1
          ? tr("Moved {n} takes to {project}.", { n: moving.length, project: tr(projectName(project ?? UNSORTED, projects)) })
          : tr("Moved the take to {project}.", { project: tr(projectName(project ?? UNSORTED, projects)) }),
        "done",
      );
      if (selecting) stopSelecting();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-[1560px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[var(--nf-left)_minmax(0,1fr)]" style={{ "--nf-left": columnWidth(projectsOpen, "230px") } as React.CSSProperties}>
      <SidePanel
        id="library-projects"
        side="left"
        label="Projects"
        aria-label={tr("Projects")}
        className="lg:sticky lg:top-[69px] lg:max-h-[calc(100dvh_-_90px)] lg:self-start"
        bodyClassName="flex flex-col gap-1 lg:overflow-y-auto"
      >
        <h2 className="px-2 pb-1 text-[13px] font-semibold text-dim">{tr("Projects")}</h2>
        <SideItem icon={<Layers size={14} />} label={tr("All projects")} count={count(null)} active={current === null} onPick={() => setCurrent(null)} />
        <SideItem icon={<Inbox size={14} />} label={tr("Unsorted")} count={count(UNSORTED)} active={current === UNSORTED} onPick={() => setCurrent(UNSORTED)} onDropTakes={dropInto(null)} dropKey="unsorted" />
        {projects.map((p) => (
          <ProjectItem key={p.id} project={p} count={count(p.id)} active={current === p.id} onPick={() => setCurrent(p.id)} onDropTakes={dropInto(p.id)} />
        ))}
        <div className="mt-2">
          <NewProject onCreated={(id) => setCurrent(id)} />
        </div>
      </SidePanel>

      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="display text-[30px] leading-tight">{current === null ? tr("Library") : tr(projectName(current, projects))}</h1>
            <p className="text-[13px] text-dim">
              {list.length === 1 ? tr("1 take, newest first. Hover a frame to scrub through it.") : tr("{n} takes, newest first. Hover a frame to scrub through it.", { n: list.length })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selecting ? (
              <>
                <span className="readout text-[14px]">{tr("{n} selected", { n: picked.length })}</span>
                <button onClick={() => setSelected(new Set(list.map((j) => j.id)))} className="rounded-md px-2.5 py-1.5 text-[13px] text-dim hover:bg-raised hover:text-ink">
                  {tr("Select all")}
                </button>
                {picked.length > 0 && <MoveToProject ids={picked} onMoved={stopSelecting} />}
                <button onClick={stopSelecting} className="rounded-md px-2.5 py-1.5 text-[13px] text-dim hover:bg-raised hover:text-ink">
                  {tr("Done")}
                </button>
              </>
            ) : (
              <button onClick={() => setSelecting(true)} className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
                <CheckSquare size={14} /> {tr("Select")}
              </button>
            )}
            <div className="w-full max-w-[520px] min-w-[300px]">
              <Segmented<TakeFilter> label={tr("Filter takes")} value={filter} onChange={setFilter} options={TAKE_FILTERS} />
            </div>
          </div>
        </div>

        {list.length === 0 && (
          <div className="flex flex-col items-start gap-3 rounded-md bg-panel p-8">
            <Clapperboard className="text-faint" />
            <p className="text-[15px]">
              {filter === "starred"
                ? tr("Star a take to keep it here.")
                : current && current !== UNSORTED
                  ? tr("Nothing in this project yet. New takes land here while it's selected, or move takes in with Select.")
                  : tr("No takes yet.")}
            </p>
            <Link href="/" className="rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
              {tr("Go to the studio")}
            </Link>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.day} className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold text-dim">{g.day}</h2>
            <div key={reveal.key} className={clsx("grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-3 gap-y-5", reveal.className)}>
              {g.jobs.map((j) => (
                <TakeCard
                  key={j.id}
                  job={j}
                  onOpen={setOpen}
                  dragIds={dragFor}
                  selecting={selecting}
                  selected={selected.has(j.id)}
                  onSelect={toggle}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <AnimatePresence>{viewing && <TakeViewer job={viewing} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

/** A count that ticks (a brief neon pulse) when it changes, never on first paint. */
function TickCount({ n }: { n: number }) {
  const ref = usePulse<HTMLSpanElement>(n, "nf-tick");
  return (
    <span ref={ref} className="readout inline-block text-[13px] text-faint">
      {n}
    </span>
  );
}

function SideItem({
  icon,
  label,
  count,
  active,
  onPick,
  onDropTakes,
  dropKey,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onPick: () => void;
  /** Takes dragged from the grid land here. */
  onDropTakes?: (ids: string[]) => void;
  /** Where moved takes fly to ("unsorted" or a project id). */
  dropKey?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <button
      onClick={onPick}
      data-drop-project={dropKey}
      aria-current={active ? "true" : undefined}
      onDragOver={(e) => {
        if (!onDropTakes || !isTakeDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!onDropTakes) return;
        e.preventDefault();
        setOver(false);
        onDropTakes(takesFrom(e));
      }}
      className={clsx(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] transition-[background-color,color,box-shadow]",
        over ? "bg-tungsten/15 text-ink shadow-[inset_0_0_0_1px_var(--color-tungsten)]" : active ? "bg-raised text-ink" : "text-dim hover:bg-panel hover:text-ink",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {over ? (
        <span className="text-[12px] text-tungsten">{tr("Move here")}</span>
      ) : (
        <TickCount n={count} />
      )}
    </button>
  );
}

function ProjectItem({ project, count, active, onPick, onDropTakes }: { project: Project; count: number; active: boolean; onPick: () => void; onDropTakes: (ids: string[]) => void }) {
  const { rename, remove } = useProjects();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);

  if (editing) {
    return (
      <form
        className="flex items-center gap-1 px-1"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await rename(project.id, name);
            setEditing(false);
          } catch (err) {
            fail(err);
          }
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="min-w-0 flex-1 rounded bg-surround px-2 py-1 text-[14px] focus:outline-none"
          aria-label={tr("Project name")}
        />
      </form>
    );
  }
  return (
    <div className="group relative">
      <SideItem icon={<Folder size={14} className="text-tungsten" />} label={project.name} count={count} active={active} onPick={onPick} onDropTakes={onDropTakes} dropKey={project.id} />
      <div className="absolute top-1/2 right-8 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Menu label={`Options for ${project.name}`} align="right" trigger={() => <MoreHorizontal size={15} className="text-dim hover:text-ink" />}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  setName(project.name);
                  setEditing(true);
                }}
              >
                <Pencil size={13} /> {tr("Rename")}
              </MenuItem>
              <MenuItem
                danger
                onClick={async () => {
                  close();
                  if (!confirm(tr("Delete the project “{name}”? Its takes ({n}) move to Unsorted; nothing is deleted.", { name: project.name, n: count }))) return;
                  try {
                    await remove(project.id);
                    toast(tr("Deleted “{name}”. Its takes are in Unsorted.", { name: project.name }), "done");
                  } catch (e) {
                    fail(e);
                  }
                }}
              >
                <Trash2 size={13} /> {tr("Delete project")}
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

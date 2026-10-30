"use client";

import { Check, ChevronDown, Folder, FolderInput, FolderPlus, Inbox, Layers } from "lucide-react";
import { useState } from "react";
import { UNSORTED } from "@/lib/projects";
import { fail, toast } from "./api";
import { Menu, MenuItem } from "./Menu";
import { inView, projectName, useProjects } from "./projects";
import { useLive } from "./state";
import { tr } from "@/i18n";

/** Header switcher: which project you're working in. New takes go there. */
export function ProjectSwitcher() {
  const { list, current, setCurrent } = useProjects();
  const jobs = useLive((s) => s.jobs);
  const count = (view: string | null) => Object.values(jobs).filter((j) => inView(j, view)).length;

  return (
    <Menu
      label={tr("Switch project")}
      trigger={(open) => (
        <span data-project-switcher className="flex max-w-[220px] items-center gap-1.5 rounded-md bg-panel px-2.5 py-1.5 text-[13px] hover:bg-raised">
          {current === null ? <Layers size={14} className="text-dim" /> : current === UNSORTED ? <Inbox size={14} className="text-dim" /> : <Folder size={14} className="text-tungsten" />}
          <span className="truncate">{tr(projectName(current, list))}</span>
          <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </span>
      )}
    >
      {(close) => (
        <div className="flex max-h-[70vh] flex-col overflow-y-auto">
          <ViewItem icon={<Layers size={14} />} label={tr("All projects")} count={count(null)} active={current === null} onPick={() => (setCurrent(null), close())} />
          <ViewItem icon={<Inbox size={14} />} label={tr("Unsorted")} count={count(UNSORTED)} active={current === UNSORTED} onPick={() => (setCurrent(UNSORTED), close())} />
          {list.length > 0 && <div className="my-1 border-t border-line" />}
          {list.map((p) => (
            <ViewItem key={p.id} icon={<Folder size={14} className="text-tungsten" />} label={p.name} count={count(p.id)} active={current === p.id} onPick={() => (setCurrent(p.id), close())} />
          ))}
          <div className="my-1 border-t border-line" />
          <NewProject
            onCreated={(id) => {
              setCurrent(id);
              close();
            }}
          />
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-faint">{tr("New takes go into the project you're in.")}</p>
        </div>
      )}
    </Menu>
  );
}

function ViewItem({ icon, label, count, active, onPick }: { icon: React.ReactNode; label: string; count: number; active: boolean; onPick: () => void }) {
  return (
    <MenuItem onClick={onPick} active={active}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="readout text-[13px] text-faint">{count}</span>
      {active && <Check size={13} className="text-tungsten" />}
    </MenuItem>
  );
}

export function NewProject({ onCreated, placeholder = tr("New project") }: { onCreated: (id: string) => void; placeholder?: string }) {
  const create = useProjects((s) => s.create);
  const [name, setName] = useState("");
  return (
    <form
      className="flex items-center gap-1.5 px-1 py-0.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        try {
          const p = await create(name);
          setName("");
          onCreated(p.id);
          toast(tr("Created “{name}”.", { name: p.name }), "done");
        } catch (err) {
          fail(err);
        }
      }}
    >
      <FolderPlus size={14} className="ml-1.5 shrink-0 text-dim" />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded bg-surround px-2 py-1 text-[13px] placeholder:text-faint focus:outline-none"
        aria-label={tr("New project name")}
      />
      {name.trim() && <button className="rounded bg-tungsten px-2 py-1 text-[12px] font-semibold text-black">{tr("Add")}</button>}
    </form>
  );
}

/** "Move to project" for one take or a selection. */
export function MoveToProject({ ids, currentProject, onMoved, compact }: { ids: string[]; currentProject?: string; onMoved?: () => void; compact?: boolean }) {
  return (
    <Menu
      label={tr("Move to project")}
      align="right"
      trigger={() =>
        compact ? (
          <span className="rounded p-1 text-ink hover:bg-white/15">
            <FolderInput size={14} />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
            <FolderInput size={14} /> {tr("Move to…")}
          </span>
        )
      }
    >
      {(close) => <MoveToProjectPanel ids={ids} currentProject={currentProject} onMoved={onMoved} close={close} />}
    </Menu>
  );
}

/** The projects to move takes into: the body of "Move to project", for any menu. */
export function MoveToProjectPanel({ ids, currentProject, onMoved, close }: { ids: string[]; currentProject?: string; onMoved?: () => void; close: () => void }) {
  const { list, move } = useProjects();
  const go = async (project: string | null) => {
    close();
    try {
      await move(ids, project);
      toast(
        ids.length > 1
          ? tr("Moved {n} takes to {project}.", { n: ids.length, project: tr(projectName(project ?? UNSORTED, list)) })
          : tr("Moved the take to {project}.", { project: tr(projectName(project ?? UNSORTED, list)) }),
        "done",
      );
      onMoved?.();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="flex max-h-[50vh] flex-col overflow-y-auto">
      {list.map((p) => (
        <MenuItem key={p.id} onClick={() => go(p.id)} active={currentProject === p.id}>
          <Folder size={14} className="text-tungsten" /> <span className="truncate">{p.name}</span>
        </MenuItem>
      ))}
      <MenuItem onClick={() => go(null)} active={!currentProject}>
        <Inbox size={14} /> {tr("Unsorted")}
      </MenuItem>
      <div className="my-1 border-t border-line" />
      <NewProject placeholder={tr("Into a new project")} onCreated={(id) => go(id)} />
    </div>
  );
}

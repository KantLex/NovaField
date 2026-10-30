"use client";

import clsx from "clsx";
import { AlertTriangle, LayoutGrid, LoaderCircle, Maximize, Minus, PanelRight, Plus, Redo2, Save, Undo2 } from "lucide-react";
import { IconButton } from "../controls";
import { tr } from "@/i18n";

/** Graph mode's toolbar: save or discard, undo, add and tidy nodes, zoom, and how the graph stands. */
export function GraphToolbar({
  dirty,
  saving,
  onSave,
  onDiscard,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddNode,
  onArrange,
  onFit,
  zoom,
  onZoom,
  nodes,
  runs,
  errors,
  inspector,
  onToggleInspector,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddNode: () => void;
  onArrange: () => void;
  onFit: () => void;
  zoom: number;
  onZoom: (factor: number) => void;
  nodes: number;
  runs: number;
  errors: number;
  inspector: boolean;
  onToggleInspector: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line/70 px-2.5 py-2">
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        className={clsx(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
          dirty ? "bg-tungsten text-black hover:bg-[#efff6b]" : "bg-raised text-dim",
        )}
        title={tr("Save (⌘S): the edited graph becomes the workflow")}
      >
        {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />} {tr(dirty ? "Save" : "Saved")}
      </button>
      {dirty && (
        <button onClick={onDiscard} className="rounded-md px-2.5 py-1.5 text-[12px] text-dim hover:bg-raised hover:text-ink">
          {tr("Discard")}
        </button>
      )}
      <span className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
        <Undo2 size={14} />
      </IconButton>
      <IconButton label="Redo (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
        <Redo2 size={14} />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <button onClick={onAddNode} className="flex items-center gap-1 rounded-md bg-raised px-2.5 py-1.5 text-[12px] hover:bg-hover" title={tr("Add a node (A, or double-click the canvas)")}>
        <Plus size={13} /> {tr("Node")}
      </button>
      <IconButton label="Tidy up: lay the graph out again" onClick={onArrange}>
        <LayoutGrid size={14} />
      </IconButton>
      <IconButton label="Fit (F)" onClick={onFit}>
        <Maximize size={14} />
      </IconButton>
      <IconButton label="Zoom out" onClick={() => onZoom(1 / 1.2)}>
        <Minus size={14} />
      </IconButton>
      <span className="readout w-11 text-center text-[13px] text-dim">{Math.round(zoom * 100)}%</span>
      <IconButton label="Zoom in" onClick={() => onZoom(1.2)}>
        <Plus size={14} />
      </IconButton>
      <span className="ml-auto flex items-center gap-2 text-[12px]">
        <span className="text-faint">{tr("{n} nodes · {r} run", { n: nodes, r: runs })}</span>
        {errors > 0 ? (
          <span className="flex items-center gap-1 rounded-full bg-tally/15 px-2 py-0.5 text-tally">
            <AlertTriangle size={12} /> {tr("{n} to fix", { n: errors })}
          </span>
        ) : (
          <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok">{tr("Ready to run")}</span>
        )}
        <IconButton label={inspector ? "Hide the inspector" : "Show the inspector"} onClick={onToggleInspector} active={inspector}>
          <PanelRight size={14} />
        </IconButton>
      </span>
    </div>
  );
}

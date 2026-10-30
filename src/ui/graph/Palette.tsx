"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { canConnect, isValueSpec } from "@/lib/comfy/edit";
import { inputType, type ObjectInfo } from "@/lib/comfy/validate";
import { typeColor } from "./info";
import { tr } from "@/i18n";

export interface PaletteEntry {
  classType: string;
  name: string;
  category: string;
  api: boolean;
  /** For a wire dropped in empty space: the input the new node takes it on. */
  input?: string;
  /** For an empty input clicked: the output of the new node that feeds it. */
  output?: number;
}

/** Narrow the list: nodes that can take a wire of this type ("in"), or feed an input of it ("out"). */
export type Need = { dir: "in" | "out"; type: string };

/**
 * Add a node: search the server's whole node list. Opened from a dropped wire, it lists only
 * nodes that can take that wire, and the editor connects the one you pick.
 */
/** Suggestions only list nodes that name the type outright; wildcard and template sockets take anything, so they'd flood the list. */
const names = (want: string, got: string) => want !== "*" && got !== "*" && !want.startsWith("COMFY_") && !got.startsWith("COMFY_") && canConnect(want, got);

export function Palette({ info, at, need, onPick, onClose }: { info: ObjectInfo; at: { x: number; y: number }; need?: Need; onPick: (e: PaletteEntry) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const all = useMemo(() => {
    const out: PaletteEntry[] = [];
    for (const [classType, def] of Object.entries(info)) {
      if ((def as { deprecated?: boolean }).deprecated) continue;
      let input: string | undefined;
      let output: number | undefined;
      if (need?.dir === "in") {
        const specs = { ...(def.input.required ?? {}), ...(def.input.optional ?? {}) };
        input = Object.entries(specs).find(([, s]) => !isValueSpec(s) && names(inputType(s), need.type))?.[0];
        if (!input) continue;
      } else if (need?.dir === "out") {
        const i = def.output.findIndex((t) => names(need.type, t));
        if (i < 0) continue;
        output = i;
      }
      out.push({ classType, name: def.display_name || classType, category: (def as { category?: string }).category ?? "", api: !!def.api_node, input, output });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [info, need]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const score = (e: PaletteEntry) => {
      const hay = `${e.name} ${e.classType} ${e.category}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return -1;
      // Names that start with the search come first.
      return (e.name.toLowerCase().startsWith(words[0] ?? "") ? 2 : 0) + (e.classType.toLowerCase().startsWith(words[0] ?? "") ? 1 : 0);
    };
    return all
      .map((e) => [e, score(e)] as const)
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1] || a[0].name.length - b[0].name.length)
      .slice(0, 80)
      .map(([e]) => e);
  }, [all, q]);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      className="absolute z-30 flex w-[340px] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.7)]"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search size={14} className="text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (e.key === "ArrowDown" ? Math.min(shown.length - 1, a + 1) : Math.max(0, a - 1)));
            } else if (e.key === "Enter" && shown[active]) onPick(shown[active]);
            else if (e.key === "Escape") onClose();
          }}
          placeholder={need ? tr(need.dir === "in" ? "Nodes that take {type}" : "Nodes that give {type}", { type: need.type }) : tr("Add a node: KSampler, Load Image, upscale…")}
          className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
        />
        {need && <span className="size-2.5 shrink-0 rounded-full" style={{ background: typeColor(need.type) }} title={need.type} />}
      </label>
      <div ref={list} className="max-h-[320px] overflow-y-auto p-1">
        {shown.length === 0 && <p className="px-2 py-3 text-[12px] text-faint">{tr("No node matches.")}</p>}
        {shown.map((e, i) => (
          <button
            key={e.classType}
            data-i={i}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(e)}
            className={clsx("flex w-full flex-col items-start rounded px-2 py-1.5 text-left", i === active ? "bg-raised" : "")}
          >
            <span className="flex w-full items-center gap-2 text-[13px] text-ink">
              <span className="truncate">{e.name}</span>
              {e.api && <span className="rounded bg-daylight px-1 text-[10px] font-semibold text-black">{tr("Paid")}</span>}
              {e.input && <span className="ml-auto shrink-0 text-[11px] text-faint">→ {e.input}</span>}
              {e.output !== undefined && <span className="ml-auto shrink-0 text-[11px] text-faint">{info[e.classType].output_name?.[e.output] ?? info[e.classType].output[e.output]} →</span>}
            </span>
            <span className="w-full truncate text-[11px] text-faint">{e.category || e.classType}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

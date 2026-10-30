"use client";

import clsx from "clsx";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { rowsOf } from "@/lib/comfy/edit";
import { isLink, type InputValue } from "@/lib/comfy/graph";
import { enumOptions, errorsOf, warningsOf, type Issue, type ObjectInfo } from "@/lib/comfy/validate";
import type { Doc } from "./doc";
import { typeColor } from "./info";
import { tr } from "@/i18n";

/**
 * The panel beside the canvas: the selected node's title, values and problems; several selected;
 * or, with nothing selected, what stops the graph running and how editing works.
 */
export function GraphInspector({
  info,
  doc,
  sel,
  one,
  issues,
  formByNode,
  focusText,
  onFocusDone,
  onValue,
  onTitle,
  onDelete,
  onDuplicate,
  onFocusNode,
}: {
  info: ObjectInfo;
  doc: Doc;
  sel: Set<string>;
  one: string | null;
  issues: Issue[];
  formByNode: Record<string, Record<string, string>>;
  focusText: { node: string; input: string } | null;
  onFocusDone: () => void;
  onValue: (id: string, input: string, v: InputValue) => void;
  onTitle: (id: string, t: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onFocusNode: (id: string) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusText && textRef.current) {
      textRef.current.focus();
      onFocusDone();
    }
  }, [focusText, onFocusDone]);

  const box = "flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-line/70 bg-[#101010] p-3 text-[12px]";
  if (one && doc.graph[one]) {
    const node = doc.graph[one];
    const def = info[node.class_type];
    const r = rowsOf(node.class_type, node.inputs, info);
    const mine = issues.filter((i) => i.node === one);
    return (
      <aside className={box} data-scrolls>
        <div className="flex flex-col gap-1">
          <input
            key={one}
            defaultValue={node._meta?.title ?? ""}
            placeholder={def?.display_name ?? node.class_type}
            onChange={(e) => onTitle(one, e.target.value)}
            className="rounded bg-surround px-2 py-1.5 text-[14px] font-semibold focus:outline-none"
            aria-label={tr("Node title")}
          />
          <span className="text-faint">
            #{one} · {node.class_type}
            {def?.category ? ` · ${def.category}` : ""}
          </span>
          {def?.description && <p className="text-dim">{def.description}</p>}
        </div>
        {mine.map((i, k) => (
          <p key={k} className={clsx("rounded px-2 py-1.5", i.level === "warning" ? "bg-tungsten/10 text-tungsten" : "bg-tally/10 text-tally")}>
            {i.input ? <b>{i.input}: </b> : null}
            {i.message}
          </p>
        ))}
        <div className="flex flex-col gap-2.5">
          {r.inputs.map((row) => {
            const v = node.inputs[row.name];
            const form = formByNode[one]?.[row.name];
            if (isLink(v)) {
              return (
                <div key={row.name} className="flex items-center justify-between gap-2">
                  <span className="text-dim">{row.name}</span>
                  <button onClick={() => onFocusNode(v[0])} className="readout text-[12px] text-faint hover:text-ink">
                    {tr("from #{id}", { id: v[0] })} · {doc.graph[v[0]]?._meta?.title ?? doc.graph[v[0]]?.class_type}
                  </button>
                </div>
              );
            }
            if (!row.value) {
              return (
                <div key={row.name} className="flex items-center justify-between gap-2">
                  <span className={row.required ? "text-tally" : "text-dim"}>{row.name}</span>
                  <span className="text-faint">{tr(row.required ? "needs a {type}" : "optional {type}", { type: row.type })}</span>
                </div>
              );
            }
            const opts = (row.spec?.[1] ?? {}) as { min?: number; max?: number; step?: number; multiline?: boolean };
            const list = row.spec ? enumOptions(row.spec) : null;
            const text = typeof v === "string" && (opts.multiline || v.length > 40);
            return (
              <label key={row.name} className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2 text-dim">
                  {row.name}
                  {form && <span className="text-[11px] text-tungsten">{tr("on the form: {name}", { name: form })}</span>}
                </span>
                {list ? (
                  <select value={String(v ?? "")} onChange={(e) => onValue(one, row.name, e.target.value)} className="rounded bg-surround px-2 py-1 text-[12px]">
                    {!list.includes(String(v)) && v !== undefined && <option value={String(v)}>{String(v)} (missing)</option>}
                    {list.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : row.type === "BOOLEAN" ? (
                  <input type="checkbox" checked={v === true} onChange={(e) => onValue(one, row.name, e.target.checked)} className="self-start accent-tungsten" />
                ) : row.type === "INT" || row.type === "FLOAT" ? (
                  <input
                    type="number"
                    value={typeof v === "number" ? v : ""}
                    min={opts.min}
                    max={opts.max}
                    step={opts.step ?? (row.type === "INT" ? 1 : 0.01)}
                    onChange={(e) => e.target.value !== "" && onValue(one, row.name, row.type === "INT" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
                    className="readout rounded bg-surround px-2 py-1 text-[13px]"
                  />
                ) : text || opts.multiline ? (
                  <textarea
                    ref={focusText?.node === one && focusText.input === row.name ? textRef : undefined}
                    value={String(v ?? "")}
                    onChange={(e) => onValue(one, row.name, e.target.value)}
                    rows={6}
                    className="resize-y rounded bg-surround px-2 py-1.5 text-[12px] leading-relaxed"
                  />
                ) : (
                  <input value={String(v ?? "")} onChange={(e) => onValue(one, row.name, e.target.value)} className="rounded bg-surround px-2 py-1 text-[12px]" />
                )}
              </label>
            );
          })}
        </div>
        {r.outputs.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-dim">{tr("Gives")}</span>
            {r.outputs.map((o, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: typeColor(o.type) }} /> {o.name}
                <span className="text-faint">{o.type}</span>
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto flex gap-2 border-t border-line/60 pt-3">
          <button onClick={onDuplicate} className="flex items-center gap-1 rounded-md bg-raised px-2.5 py-1.5 hover:bg-hover">
            <Copy size={12} /> {tr("Duplicate")}
          </button>
          <button onClick={onDelete} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-tally hover:bg-raised">
            <Trash2 size={12} /> {tr("Delete")}
          </button>
        </div>
      </aside>
    );
  }

  if (sel.size > 1) {
    return (
      <aside className={box} data-scrolls>
        <p className="text-[14px]">{tr("{n} nodes selected", { n: sel.size })}</p>
        <p className="text-dim">{tr("Drag any of them to move them together.")}</p>
        <div className="flex gap-2">
          <button onClick={onDuplicate} className="flex items-center gap-1 rounded-md bg-raised px-2.5 py-1.5 hover:bg-hover">
            <Copy size={12} /> {tr("Duplicate")}
          </button>
          <button onClick={onDelete} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-tally hover:bg-raised">
            <Trash2 size={12} /> {tr("Delete")}
          </button>
        </div>
      </aside>
    );
  }

  const errs = errorsOf(issues);
  const warns = warningsOf(issues);
  return (
    <aside className={box} data-scrolls>
      {errs.length === 0 ? (
        <p className="rounded bg-ok/10 px-2 py-1.5 text-ok">{tr("The server can run this graph as it is.")}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-dim">{tr("To fix before it runs")}</span>
          {errs.map((i, k) => (
            <button key={k} onClick={() => onFocusNode(i.node)} className="rounded bg-tally/10 px-2 py-1.5 text-left text-tally hover:bg-tally/15">
              <b>
                #{i.node} {i.classType}
                {i.input ? `.${i.input}` : ""}
              </b>
              <br />
              {i.message}
            </button>
          ))}
        </div>
      )}
      {warns.length > 0 && <p className="text-tungsten/80">{tr("Notes: {n}. Inputs added by browser extensions; they pass through.", { n: warns.length })}</p>}
      <div className="flex flex-col gap-1 border-t border-line/60 pt-3 text-dim">
        <span className="text-ink/80">{tr("How it works")}</span>
        <span>{tr("Drag from a coloured output dot to an input; matching inputs light up.")}</span>
        <span>{tr("Let go of a wire in empty space to pick a node that takes it.")}</span>
        <span>{tr("Click an empty input dot to pick a node that feeds it.")}</span>
        <span>{tr("Drag a wire off its input to move or remove it.")}</span>
        <span>{tr("Faded nodes don't feed an output, so they won't run.")}</span>
        <span>{tr("A yellow dot marks inputs that are on the workflow's form.")}</span>
      </div>
    </aside>
  );
}

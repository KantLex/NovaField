"use client";

import clsx from "clsx";
import { memo } from "react";
import { canConnect, HEAD_H, NODE_W, ROW_H, type InputRow, type OutputRow, type Pos } from "@/lib/comfy/edit";
import { isLink, type ApiNode, type InputValue } from "@/lib/comfy/graph";
import { enumOptions, type NodeInfo } from "@/lib/comfy/validate";
import { typeColor } from "./info";
import { tr } from "@/i18n";

export interface Wiring {
  /** Type being dragged from an output: compatible inputs light up. */
  type: string;
  from: string;
}

export interface NodeCardProps {
  id: string;
  node: ApiNode;
  def?: NodeInfo;
  pos: Pos;
  rows: { outputs: OutputRow[]; inputs: InputRow[] };
  selected: boolean;
  /** Doesn't feed an output, so it won't run. */
  idle: boolean;
  errors: number;
  /** Inputs that are on the workflow's form: input name → field label. */
  formFields: Record<string, string>;
  wiring: Wiring | null;
  flash: boolean;
  onGrab: (id: string, e: React.PointerEvent) => void;
  onWireFromOutput: (id: string, slot: number, type: string, e: React.PointerEvent) => void;
  onGrabInput: (id: string, input: string, e: React.PointerEvent) => void;
  onValue: (id: string, input: string, value: InputValue) => void;
  onEditText: (id: string, input: string) => void;
}

/**
 * One node on the canvas. Rows have a fixed height so socket positions are arithmetic; the editor
 * draws the wires from the same numbers.
 */
export const NodeCard = memo(function NodeCard(p: NodeCardProps) {
  const { id, node, def, pos, rows, selected, idle, errors, wiring } = p;
  const title = node._meta?.title || def?.display_name || node.class_type;
  const missing = !def;
  return (
    <div
      data-node={id}
      className={clsx(
        "absolute flex flex-col rounded-[7px] bg-[#141414] text-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-[box-shadow,opacity] duration-150",
        selected
          ? "shadow-[0_0_0_2px_var(--color-tungsten),0_8px_24px_rgba(0,0,0,0.55)]"
          : errors
            ? "shadow-[0_0_0_1.5px_var(--color-tally),0_8px_24px_rgba(0,0,0,0.45)]"
            : "shadow-[0_0_0_1px_#2c2c2c,0_8px_24px_rgba(0,0,0,0.45)]",
        idle && !selected && "opacity-55",
        p.flash && "animate-[nf-flash_0.9s_ease-out]",
      )}
      style={{ left: pos[0], top: pos[1], width: NODE_W }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={clsx(
          "flex cursor-grab items-center gap-2 rounded-t-[7px] px-2.5 active:cursor-grabbing",
          missing ? "bg-tally/25" : def?.api_node ? "bg-daylight/10" : "bg-[#1d1d1d]",
        )}
        style={{ height: HEAD_H }}
        onPointerDown={(e) => p.onGrab(id, e)}
        title={def?.description || node.class_type}
      >
        <span className="readout shrink-0 text-[11px] text-faint">#{id}</span>
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{title}</span>
        {def?.api_node && <span className="rounded bg-daylight px-1 text-[10px] font-semibold text-black">{tr("Paid")}</span>}
        {missing && <span className="rounded bg-tally px-1 text-[10px] font-semibold text-black">{tr("Not on server")}</span>}
        {errors > 0 && !missing && <span className="flex size-4 items-center justify-center rounded-full bg-tally text-[10px] font-bold text-black">{errors}</span>}
      </div>

      {rows.outputs.map((o, i) => (
        <div key={`o${i}`} className="relative flex items-center justify-end gap-2 pr-3.5 pl-2 text-dim" style={{ height: ROW_H }}>
          <span className="truncate">{o.name}</span>
          <span
            data-socket-out
            onPointerDown={(e) => p.onWireFromOutput(id, i, o.type, e)}
            className="absolute -right-[6px] size-3 cursor-crosshair rounded-full border-2 border-[#141414] transition-transform hover:scale-125"
            style={{ background: typeColor(o.type) }}
            title={tr("{type}: drag to an input", { type: o.type })}
          />
        </div>
      ))}

      {rows.inputs.map((r) => {
        const v = node.inputs[r.name];
        const linked = isLink(v);
        const ok = wiring ? wiring.from !== id && canConnect(r.type, wiring.type) : false;
        const form = p.formFields[r.name];
        return (
          <div key={r.name} className="relative flex items-center gap-2 pr-2 pl-3.5" style={{ height: ROW_H }}>
            <span
              data-socket-in
              data-node={id}
              data-input={r.name}
              data-type={r.type}
              onPointerDown={(e) => p.onGrabInput(id, r.name, e)}
              className={clsx(
                "absolute -left-[6px] size-3 rounded-full border-2 border-[#141414] transition-[transform,opacity,box-shadow] duration-150",
                linked ? "cursor-grab" : "cursor-crosshair",
                wiring && (ok ? "scale-150 shadow-[0_0_0_3px_rgba(228,255,26,0.35)]" : "opacity-25"),
                !linked && !wiring && r.value && "opacity-40",
              )}
              style={{ background: linked || !r.value ? typeColor(r.type) : "#3a3a3a" }}
              title={r.type}
            />
            <span className={clsx("min-w-0 shrink truncate", r.required && !linked && !r.value && v === undefined ? "text-tally" : "text-dim")}>
              {form && <span className="mr-1 inline-block size-1.5 rounded-full bg-tungsten align-middle" title={tr("On the form as “{name}”", { name: form })} />}
              {r.name}
            </span>
            <span className="ml-auto flex min-w-0 justify-end">
              {linked ? (
                <span className="readout truncate text-[11px] text-faint">← #{v[0]}</span>
              ) : r.value ? (
                <ValueControl id={id} row={r} value={v} onValue={p.onValue} onEditText={p.onEditText} />
              ) : null}
            </span>
          </div>
        );
      })}
      <div className="h-2" />
    </div>
  );
});

function ValueControl({ id, row, value, onValue, onEditText }: { id: string; row: InputRow; value: InputValue | undefined; onValue: NodeCardProps["onValue"]; onEditText: NodeCardProps["onEditText"] }) {
  const opts = (row.spec?.[1] ?? {}) as { min?: number; max?: number; step?: number; multiline?: boolean };
  const stop = (e: React.PointerEvent | React.KeyboardEvent) => e.stopPropagation();
  const base = "h-[20px] rounded bg-[#0b0b0b] px-1.5 text-[12px] text-ink outline-none focus:ring-1 focus:ring-tungsten/60";
  const list = row.spec ? enumOptions(row.spec) : null;

  if (list) {
    return (
      <select value={String(value ?? "")} onChange={(e) => onValue(id, row.name, e.target.value)} onPointerDown={stop} className={clsx(base, "max-w-[150px] truncate")} title={String(value ?? "")}>
        {!list.includes(String(value)) && value !== undefined && <option value={String(value)}>{String(value)} (missing)</option>}
        {list.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (row.type === "BOOLEAN") {
    const on = value === true;
    return (
      <button
        onPointerDown={stop}
        onClick={() => onValue(id, row.name, !on)}
        role="switch"
        aria-checked={on}
        className={clsx("relative h-[16px] w-[28px] rounded-full transition-colors", on ? "bg-tungsten" : "bg-[#2c2c2c]")}
      >
        <span className={clsx("absolute top-[2px] size-3 rounded-full transition-[left]", on ? "left-[14px] bg-black" : "left-[2px] bg-dim")} />
      </button>
    );
  }
  if (row.type === "INT" || row.type === "FLOAT") {
    return (
      <input
        type="number"
        value={typeof value === "number" ? value : ""}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? (row.type === "INT" ? 1 : 0.01)}
        onPointerDown={stop}
        onKeyDown={stop}
        onChange={(e) => e.target.value !== "" && onValue(id, row.name, row.type === "INT" ? Math.round(Number(e.target.value)) : Number(e.target.value))}
        className={clsx(base, "readout w-[96px] text-right text-[13px]")}
      />
    );
  }
  if (opts.multiline || (typeof value === "string" && value.length > 40)) {
    return (
      <button onPointerDown={stop} onClick={() => onEditText(id, row.name)} className="max-w-[160px] truncate rounded bg-[#0b0b0b] px-1.5 text-left text-[12px] text-ink/80 hover:text-ink" title={String(value ?? "")}>
        {String(value ?? "") || <span className="text-faint">{tr("Empty")}</span>}
      </button>
    );
  }
  return (
    <input value={String(value ?? "")} onPointerDown={stop} onKeyDown={stop} onChange={(e) => onValue(id, row.name, e.target.value)} className={clsx(base, "w-[150px]")} />
  );
}

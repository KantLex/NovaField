"use client";

import clsx from "clsx";
import { ArrowLeftRight, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { InputValue } from "@/lib/comfy/graph";
import { SIZE_RATIOS, SIZE_SCALES, sizeFor } from "@/lib/workflows/apply";
import type { Field } from "@/lib/workflows/types";
import { FieldInput } from "./FieldInput";
import { tr } from "@/i18n";

const num = (v: InputValue, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback);
const fmtScale = (s: number) => (s === 0.5 ? "½×" : `${s}×`);

/**
 * Picture size by shape and pixel count instead of two raw numbers: pick an aspect ratio, then
 * how many pixels (relative to the workflow's own size), and NovaField works out width and
 * height. Custom shows the raw fields for exact numbers.
 */
export function SizeField({
  width,
  height,
  w,
  h,
  onChange,
}: {
  width: Field;
  height: Field;
  w: InputValue;
  h: InputValue;
  onChange: (width: number, height: number) => void;
}) {
  const [custom, setCustom] = useState(false);
  const cw = num(w, num(width.value, 1024));
  const ch = num(h, num(height.value, 1024));
  // The workflow's own size is "1×".
  const base = num(width.value, 1024) * num(height.value, 1024);
  const ratio = cw / ch;
  const scale = (cw * ch) / base;
  const activeRatio = SIZE_RATIOS.find((r) => Math.abs(Math.log(r.ratio / ratio)) < 0.02)?.id;
  const activeScale = SIZE_SCALES.find((s) => Math.abs(s - scale) / s < 0.08);
  const set = (r: number, area: number) => {
    const s = sizeFor(width, height, r, area);
    onChange(s.width, s.height);
  };
  const mp = (cw * ch) / 1e6;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-dim">{tr("Size")}</span>
        <span className="readout text-[14px] text-ink">
          {cw} × {ch} <span className="text-dim">· {mp.toFixed(mp < 1 ? 2 : 1)} MP</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={tr("Aspect ratio")}>
        {SIZE_RATIOS.map((r) => {
          const on = activeRatio === r.id;
          // A little frame in the ratio's shape.
          const fw = r.ratio >= 1 ? 16 : 16 * r.ratio;
          const fh = r.ratio >= 1 ? 16 / r.ratio : 16;
          return (
            <button
              key={r.id}
              role="radio"
              aria-checked={on}
              onClick={() => set(r.ratio, cw * ch)}
              className={clsx(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors",
                on ? "bg-tungsten text-black" : "bg-surround text-dim hover:text-ink",
              )}
            >
              <span className={clsx("rounded-[2px] border", on ? "border-black" : "border-current")} style={{ width: fw, height: fh }} aria-hidden />
              <span className="readout text-[13px]">{r.id}</span>
            </button>
          );
        })}
        <button
          onClick={() => onChange(ch, cw)}
          className="flex items-center gap-1 rounded-md bg-surround px-2 py-1 text-[12px] text-dim hover:text-ink"
          title={tr("Swap width and height (portrait ↔ landscape)")}
          aria-label={tr("Swap width and height")}
        >
          <ArrowLeftRight size={13} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-md bg-surround p-0.5" role="radiogroup" aria-label={tr("Pixels")}>
          {SIZE_SCALES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={activeScale === s}
              onClick={() => set(ratio, base * s)}
              title={s === 1 ? tr("The workflow's own pixel count") : tr("{n}× the workflow's pixel count, same shape", { n: s })}
              className={clsx("readout rounded px-2.5 py-0.5 text-[13px]", activeScale === s ? "bg-raised text-ink" : "text-dim hover:text-ink")}
            >
              {fmtScale(s)}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-faint">{tr("pixels, against the workflow's {size}", { size: `${num(width.value, 0)}×${num(height.value, 0)}` })}</span>
        <button
          onClick={() => setCustom((c) => !c)}
          className={clsx("ml-auto flex items-center gap-1 text-[12px]", custom ? "text-ink" : "text-dim hover:text-ink")}
          aria-expanded={custom}
        >
          <SlidersHorizontal size={12} /> {tr("Custom")}
        </button>
      </div>
      {scale > 2.2 && <p className="text-[12px] text-tungsten">{tr("That is a lot more pixels than the workflow was built for; expect a slower run and possible repeats or artefacts.")}</p>}

      {custom && (
        <div className="flex flex-col gap-3 rounded-md bg-surround/60 p-3">
          <FieldInput field={width} value={cw} onChange={(v) => typeof v === "number" && onChange(v, ch)} />
          <FieldInput field={height} value={ch} onChange={(v) => typeof v === "number" && onChange(cw, v)} />
        </div>
      )}
    </div>
  );
}

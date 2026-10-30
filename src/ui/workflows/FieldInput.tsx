"use client";

import clsx from "clsx";
import { Dices, FileAudio, ImagePlus, Upload } from "lucide-react";
import type { InputValue } from "@/lib/comfy/graph";
import { randomSeed, snap } from "@/lib/workflows/apply";
import type { Field } from "@/lib/workflows/types";
import { Toggle } from "../controls";
import { Drop } from "../Drop";
import { mediaUrl, useForms } from "./store";
import { tr } from "@/i18n";

/** One form control for one workflow field, chosen by what the field is. */
export function FieldInput({ field, value, onChange }: { field: Field; value: InputValue; onChange: (v: InputValue | undefined) => void }) {
  const uploads = useForms((s) => s.uploads);
  const remember = useForms((s) => s.remember);
  const label = <span className="text-[13px] font-semibold text-dim">{field.label}</span>;

  if (field.kind === "text") {
    return (
      <label className="flex flex-col gap-1.5">
        {label}
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={field.role === "prompt" ? 4 : 2}
          className="w-full resize-y rounded-md bg-surround px-3 py-2 text-[14px] leading-relaxed placeholder:text-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
        />
      </label>
    );
  }

  if (field.kind === "image" || field.kind === "video" || field.kind === "audio") {
    const url = mediaUrl(value, uploads);
    const accept = field.kind === "image" ? "image/*" : field.kind === "video" ? "video/*" : "audio/*";
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Drop
          purpose="raw"
          accept={accept}
          onAsset={(a) => {
            remember(a.name, a.url);
            onChange(a.name);
          }}
          className="rounded-md"
        >
          {({ over }) => (
            <div className={clsx("group relative overflow-hidden rounded-md bg-surround", over && "ring-2 ring-ink/60")}>
              {url && field.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={field.label} className="max-h-56 w-full object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
              ) : url && field.kind === "video" ? (
                <video src={url} className="max-h-56 w-full" muted loop playsInline autoPlay />
              ) : url && field.kind === "audio" ? (
                <div className="flex items-center gap-2 p-3" onClick={(e) => e.stopPropagation()}>
                  <FileAudio size={18} className="text-dim" />
                  <audio src={url} controls className="h-8 flex-1" />
                </div>
              ) : null}
              <div className={clsx("flex items-center justify-center gap-2 px-3 py-2.5 text-[12px] text-dim", url ? "border-t border-line/50" : "py-6")}>
                {field.kind === "image" ? <ImagePlus size={15} /> : <Upload size={15} />}
                <span className="truncate">{value ? tr("{name}, drop or click to replace", { name: String(value) }) : tr(field.kind === "audio" ? "Drop an audio file" : field.kind === "image" ? "Drop an image" : "Drop a video")}</span>
              </div>
            </div>
          )}
        </Drop>
      </div>
    );
  }

  if (field.kind === "seed") {
    const randomize = field.randomize && value === undefined;
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={randomize ? "" : Number(value ?? field.value)}
            placeholder={tr("New each run")}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))))}
            className="readout w-0 min-w-0 flex-1 rounded-md bg-surround px-2.5 py-1.5 text-[14px] placeholder:font-sans placeholder:text-faint focus:outline-none"
          />
          <button onClick={() => onChange(randomSeed(field))} className="rounded-md bg-raised p-1.5 hover:bg-hover" title={tr("Roll a seed")} aria-label={tr("Roll a seed")}>
            <Dices size={15} />
          </button>
          {!randomize && field.randomize && (
            <button onClick={() => onChange(undefined)} className="rounded-md px-2 py-1 text-[12px] text-dim hover:bg-raised hover:text-ink">
              {tr("New each run")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (field.kind === "toggle") {
    return <Toggle label={field.label} checked={!!value} onChange={(v) => onChange(v)} />;
  }

  if (field.kind === "choice") {
    return (
      <label className="flex flex-col gap-1.5">
        {label}
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="rounded-md bg-surround px-2.5 py-1.5 text-[14px] focus:outline-none">
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }

  // Numbers: a slider when the range is sensible, a plain box otherwise.
  const v = Number(value ?? field.value ?? 0);
  const min = field.min ?? 0;
  const max = field.max ?? 0;
  const step = field.step || (field.integer ? 1 : 0.01);
  const sliderOk = field.min !== undefined && field.max !== undefined && max > min && (max - min) / step <= 4000;
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <div className="flex items-center gap-3">
        {sliderOk && <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(Number(e.target.value))} className="h-1 min-w-0 flex-1" />}
        <input
          type="number"
          value={v}
          step={step}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          onBlur={() => onChange(snap(field, v))}
          className={clsx("readout rounded-md bg-surround px-2.5 py-1.5 text-[14px] focus:outline-none", sliderOk ? "w-24" : "w-full")}
        />
      </div>
    </div>
  );
}

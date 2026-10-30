"use client";

import clsx from "clsx";
import { Clapperboard, LoaderCircle, Replace, X } from "lucide-react";
import { previsSeconds } from "@/lib/engines/sizing";
import type { Asset, ShotSpec } from "@/lib/engines/specs";
import { Drop } from "../Drop";
import { Segmented } from "../controls";
import { tr } from "@/i18n";

type Previs = NonNullable<ShotSpec["previs"]>;

/**
 * Bring your own previs: a blockout, a phone walk-through, an animatic or a film reference. MiniMax H3
 * follows its camera (and, if asked, its blocking) instead of a preset move. Clips can be dropped,
 * picked from assets or Studio takes, or dragged in from the Library.
 */
export function PrevisSlot({
  previs,
  duration,
  onChange,
  onDuration,
}: {
  previs: Previs | null | undefined;
  duration: number;
  onChange: (p: Previs | null) => void;
  onDuration: (seconds: number) => void;
}) {
  const take = (clip: Asset) => {
    onChange({ clip, follow: previs?.follow ?? "camera" });
    onDuration(previsSeconds(clip));
  };

  if (!previs)
    return (
      <Drop purpose="h3" accept="video/*" onAsset={take} className="rounded-md">
        {({ over, busy }) => (
          <div
            className={clsx(
              "flex items-center gap-3 rounded-md border border-dashed px-3 py-2.5 transition-colors",
              over ? "border-tungsten bg-tungsten/8" : "border-line hover:border-dim",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surround text-tungsten">
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Clapperboard size={16} />}
            </span>
            <span className="flex min-w-0 flex-col pr-14">
              <span className="text-[13px] text-ink">{tr("Your own previs clip")}</span>
              <span className="text-[12px] leading-snug text-faint">{tr("Drop a blockout, a phone walk-through or an animatic, and the camera follows it.")}</span>
            </span>
          </div>
        )}
      </Drop>
    );

  const clipLength = previsSeconds(previs.clip);
  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-surround p-2.5">
      <div className="flex gap-2.5">
        <div className="relative w-[112px] shrink-0 overflow-hidden rounded-[3px] bg-black" style={{ aspectRatio: `${previs.clip.width ?? 16}/${previs.clip.height ?? 9}` }}>
          <video src={previs.clip.url} className="size-full object-cover" muted loop autoPlay playsInline aria-label={tr("Your own previs clip")} />
          <span className="absolute top-1 left-1 rounded bg-tungsten px-1 text-[10px] font-semibold text-black">{tr("Previs")}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 truncate text-[13px]" title={previs.clip.label}>
              {previs.clip.label || tr("Your own previs clip")}
            </span>
            <button onClick={() => onChange(null)} className="rounded p-0.5 text-dim hover:text-ink" aria-label={tr("Remove the previs clip")} title={tr("Remove the previs clip")}>
              <X size={14} />
            </button>
          </div>
          <span className="readout text-[13px] text-dim">
            {(previs.clip.duration ?? 0).toFixed(1)} s · {previs.clip.width}×{previs.clip.height}
          </span>
          <Drop purpose="h3" accept="video/*" onAsset={take} assets={false} className="mt-auto self-start rounded">
            {({ busy }) => (
              <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-dim hover:bg-raised hover:text-ink">
                {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Replace size={12} />} {tr("Use another clip")}
              </span>
            )}
          </Drop>
        </div>
      </div>
      <Segmented
        label={tr("Follow")}
        size="sm"
        value={previs.follow}
        onChange={(follow) => onChange({ ...previs, follow })}
        options={[
          { id: "camera", label: "Camera only", title: "Copy the camera move; the action comes from your script" },
          { id: "action", label: "Camera + action", title: "Also place and move people and objects as in the previs" },
        ]}
      />
      {Math.abs(clipLength - duration) >= 0.5 ? (
        <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-tungsten">
          <span>{tr("The shot is {shot} s; the previs clip runs {clip} s.", { shot: duration, clip: clipLength })}</span>
          <button onClick={() => onDuration(clipLength)} className="rounded bg-tungsten/15 px-1.5 py-px hover:bg-tungsten/25">
            {tr("Match the previs")}
          </button>
        </p>
      ) : (
        <p className="text-[12px] text-faint">{tr("The shot runs as long as the previs clip. Preset moves, timing and the rendered previs are set aside while it drives the camera.")}</p>
      )}
    </div>
  );
}

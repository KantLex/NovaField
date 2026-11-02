"use client";

// Henshin's stage: the source clip (or a big drop target) and the swap between source and result.

import clsx from "clsx";
import { useRef, useState } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { ASPECTS, nearestAspect, planWan } from "@/lib/engines/sizing";
import type { Asset } from "@/lib/engines/specs";
import { Segmented } from "@/ui/controls";
import { Drop } from "@/ui/Drop";
import { BoxTracker } from "@/ui/henshin/BoxTracker";
import { PathPainter } from "@/ui/henshin/PathPainter";
import { TrimBar } from "@/ui/henshin/TrimBar";
import { tr } from "@/i18n";
import { clearedBy, clipOf, modelOf, useG } from "@/ui/henshin/state";

/** The big black area: the source clip, or the editor for the current mode. */
export function Stage() {
  const g = useG();
  if (g.mode === "paths") {
    if (!g.still) return <BigDrop purpose="image" accept="image/*" label={tr("Drop a still image to animate")} onAsset={(still) => g.set({ still, paths: [] })} />;
    const ratio = g.still.width && g.still.height ? g.still.width / g.still.height : 16 / 9;
    const aspect = nearestAspect(g.still.width ?? 16, g.still.height ?? 9);
    return (
      <div className="flex flex-col gap-2">
        <PathPainter
          // A new picture is a new canvas: undo history and the painter's own state start over.
          key={g.still.url || g.still.name}
          image={g.still}
          paths={g.paths}
          timing={g.pathTiming}
          onChange={(paths, pathTiming) => g.set({ paths, pathTiming })}
          ratio={ASPECTS.find((a) => a.id === aspect)?.ratio ?? ratio}
          seconds={planWan(aspect).frames / planWan(aspect).fps}
        />
        <SwapButton label={tr("Use another image")} onClick={() => g.set({ still: undefined, paths: [], pathTiming: [] })} />
      </div>
    );
  }
  // Recast, Restyle and Replace work on a clip conformed for their model: H3's or Wan's.
  const model = modelOf(g);
  const purpose = model.clip === "h3" ? "h3" : "wan";
  const clip = clipOf(g);
  const setClip = (a: Asset | undefined) => g.set({ ...(purpose === "h3" ? { h3Source: a } : { wanSource: a }), ...clearedBy(g, purpose) });
  const wan = purpose === "wan";
  if (!clip) return <BigDrop purpose={purpose} accept="video/*" label={wan ? tr("Drop a clip (you choose which 5 s to use)") : tr("Drop a clip (you choose up to 15 s of it)")} onAsset={setClip} />;
  const trim = (
    <TrimBar
      clip={clip}
      purpose={purpose}
      max={wan ? 81 / 16 : 15}
      fixed={wan}
      warn={g.mode === "replace" && g.keys.length ? tr("Another part of the clip clears your box track. Go ahead?") : undefined}
      onClip={setClip}
    />
  );
  if (g.mode === "replace")
    return (
      <div className="flex flex-col gap-2">
        <BoxTracker key={clip.url || clip.name} source={clip} keys={g.keys} shape={g.shape} onKeys={(keys) => g.set({ keys })} />
        {trim}
        <SwapButton label={tr("Use another clip")} onClick={() => setClip(undefined)} />
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {/* H3 (or a workflow, told in words) recasts the person you pick; SCAIL-2 takes the biggest. */}
      <SourceClip clip={clip} pick={g.mode === "recast" && model.id !== "scail"} />
      {trim}
      <div className="flex items-center justify-between text-[12px] text-dim">
        <span className="readout text-[13px]">
          {clip.width}×{clip.height}, {clip.duration?.toFixed(1)} s at {clip.fps ?? 24} fps
        </span>
        <SwapButton label={tr("Use another clip")} onClick={() => setClip(undefined)} />
      </div>
    </div>
  );
}

/**
 * The clip for Recast and Restyle. In Recast, "Pick the person" lets you click who becomes your
 * character, on whatever frame shows them best; a ring marks them. Unpicked, it's the main person.
 */
function SourceClip({ clip, pick }: { clip: Asset; pick: boolean }) {
  const g = useG();
  const video = useRef<HTMLVideoElement>(null);
  const [picking, setPicking] = useState(false);
  const target = pick ? g.target : undefined;
  return (
    <>
      <div className="relative" style={{ aspectRatio: `${clip.width}/${clip.height}` }}>
        <video ref={video} src={clip.url} className="size-full rounded-[3px] bg-black" controls={!picking} loop muted playsInline />
        {target && (
          <span
            className="pointer-events-none absolute flex -translate-1/2 flex-col items-center gap-1"
            style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}
          >
            <span className="size-9 rounded-full border-2 border-tungsten shadow-[0_0_0_2px_rgba(0,0,0,0.5)]" />
            <span className="rounded bg-black/75 px-1.5 py-0.5 text-[12px] whitespace-nowrap text-tungsten">{tr("Becomes your character")}</span>
          </span>
        )}
        {picking && (
          <button
            aria-label={tr("Click the person to recast")}
            className="absolute inset-0 cursor-crosshair rounded-[3px] bg-black/20"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
              g.set({ target: { x: round((e.clientX - r.left) / r.width), y: round((e.clientY - r.top) / r.height), t: Math.round((video.current?.currentTime ?? 0) * 10) / 10 } });
              setPicking(false);
            }}
          >
            <span className="absolute inset-x-0 top-3 text-center text-[13px] text-ink [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">{tr("Click the person who becomes your character")}</span>
          </button>
        )}
      </div>
      {pick && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-dim">{tr("Who changes")}</span>
          <Segmented
            label={tr("Who changes")}
            size="sm"
            value={picking || target ? "picked" : "main"}
            onChange={(v) => {
              if (v === "main") {
                setPicking(false);
                g.set({ target: undefined });
              } else {
                video.current?.pause();
                setPicking(true);
              }
            }}
            options={[
              { id: "main", label: tr("The main person"), title: tr("Recast whoever the clip is about") },
              { id: "picked", label: target ? tr("The one you picked") : tr("Pick the person"), title: tr("Pause on a frame that shows them, then click them") },
            ]}
          />
          {target && !picking && (
            <button onClick={() => (video.current?.pause(), setPicking(true))} className="text-dim hover:text-ink hover:underline">
              {tr("Pick again")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function SwapButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="self-end rounded px-2 py-1 text-[12px] text-dim hover:bg-raised hover:text-ink">
      {label}
    </button>
  );
}

export function BigDrop({ purpose, accept, label, onAsset }: { purpose: "image" | "h3" | "wan"; accept: string; label: string; onAsset: (a: Asset) => void }) {
  return (
    <Drop purpose={purpose} accept={accept} onAsset={onAsset} className="rounded-[3px]">
      {({ over }) => (
        <div
          className={clsx(
            "flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-[3px] border border-dashed transition-colors",
            over ? "border-tungsten bg-tungsten/5 text-ink" : "border-line text-dim hover:border-dim",
          )}
        >
          {purpose === "image" ? <ImagePlus size={26} /> : <Upload size={26} />}
          <span className="text-[15px]">{label}</span>
          <span className="text-[12px] text-faint">{tr("or click to choose a file")}</span>
        </div>
      )}
    </Drop>
  );
}

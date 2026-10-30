"use client";

// Henshin's stage: the source clip (or a big drop target) and the swap between source and result.

import clsx from "clsx";
import { ImagePlus, Upload } from "lucide-react";
import { ASPECTS, nearestAspect, planWan } from "@/lib/engines/sizing";
import type { Asset } from "@/lib/engines/specs";
import { Drop } from "@/ui/Drop";
import { BoxTracker } from "@/ui/henshin/BoxTracker";
import { PathPainter } from "@/ui/henshin/PathPainter";
import { tr } from "@/i18n";
import { useG } from "@/ui/henshin/state";

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
  if (g.mode === "replace") {
    if (!g.wanSource) return <BigDrop purpose="wan" accept="video/*" label={tr("Drop a clip (the first 5 s are used)")} onAsset={(wanSource) => g.set({ wanSource, keys: [] })} />;
    return (
      <div className="flex flex-col gap-2">
        <BoxTracker key={g.wanSource.url || g.wanSource.name} source={g.wanSource} keys={g.keys} shape={g.shape} onKeys={(keys) => g.set({ keys })} />
        <SwapButton label={tr("Use another clip")} onClick={() => g.set({ wanSource: undefined, keys: [] })} />
      </div>
    );
  }
  if (!g.h3Source) return <BigDrop purpose="h3" accept="video/*" label={tr("Drop a clip, 2 to 15 seconds")} onAsset={(h3Source) => g.set({ h3Source })} />;
  return (
    <div className="flex flex-col gap-2">
      <video src={g.h3Source.url} className="w-full rounded-[3px] bg-black" style={{ aspectRatio: `${g.h3Source.width}/${g.h3Source.height}` }} controls loop muted playsInline />
      <div className="flex items-center justify-between text-[12px] text-dim">
        <span className="readout text-[13px]">
          {g.h3Source.width}×{g.h3Source.height}, {g.h3Source.duration?.toFixed(1)} s at 24 fps
        </span>
        <SwapButton label={tr("Use another clip")} onClick={() => g.set({ h3Source: undefined })} />
      </div>
    </div>
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

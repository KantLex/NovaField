"use client";

// The Image page's monitor: the picture on show, its render while it's being made, and a
// before/after comparison for any step taken on a picture.

import clsx from "clsx";
import { Columns2, ImageIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { Asset } from "@/lib/engines/specs";
import { isLive, type Job } from "@/lib/jobs";
import { Drop } from "../Drop";
import { useLive } from "../state";
import { TakePlayer } from "../TakePlayer";
import { beforeOf, openAssetInLab } from "./state";
import { tr } from "@/i18n";
import { useRouter } from "next/navigation";

export function Viewer({ job, asset, onSize }: { job: Job | null; asset: Asset | null; onSize: (s: { width: number; height: number }) => void }) {
  const jobs = useLive((s) => s.jobs);
  const router = useRouter();
  // Which picture is being compared, so showing another one turns comparing off.
  const [comparingId, setComparingId] = useState<string | null>(null);
  const before = job && job.status === "done" ? beforeOf(job, jobs) : null;
  const id = job?.id ?? asset?.name ?? null;
  const comparing = !!id && comparingId === id;

  if (!job && !asset)
    return (
      <Drop purpose="image" accept="image/*" onAsset={(a) => openAssetInLab(a, router.push)} className="size-full rounded-[3px]">
        {({ over }) => (
          <div
            className={clsx(
              "flex size-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed text-center text-[13px] transition-colors",
              over ? "border-tungsten text-ink" : "border-line text-dim",
            )}
          >
            <ImageIcon size={26} className="text-faint" />
            <span className="text-[15px] text-ink">{tr("Drop a picture to work on")}</span>
            <span className="max-w-[44ch]">{tr("Or click to choose a file, pick from your assets, or choose any picture from the strip below.")}</span>
          </div>
        )}
      </Drop>
    );

  if (job && isLive(job)) {
    const source = job.spec.kind === "image" ? job.spec.image.url : null;
    return (
      <div className="relative size-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {source && <img src={source} alt="" className="size-full object-contain opacity-35 blur-[1px]" />}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="flex items-center gap-2 text-[14px]">
            <span className={clsx("size-2 rounded-full", job.status === "running" ? "animate-pulse bg-tally" : "bg-tungsten")} />
            {job.status === "queued" && job.ahead ? tr("{n} ahead", { n: job.ahead }) : tr(job.progress.stage)}
          </span>
          <span className="h-[3px] w-48 bg-white/15">
            <span className="block h-full bg-tally transition-[width] duration-500" style={{ width: `${Math.round(job.progress.pct * 100)}%` }} />
          </span>
        </div>
      </div>
    );
  }

  if (job && job.status !== "done")
    return (
      <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center">
        <span className={job.status === "failed" ? "text-tally" : "text-dim"}>{tr(job.status === "failed" ? "Failed" : "Cancelled")}</span>
        {job.error && <span className="max-w-[60ch] text-[12px] whitespace-pre-line text-tally">{tr(job.error)}</span>}
      </div>
    );

  const after = job?.image ?? asset?.url ?? "";
  return (
    <div className="relative size-full">
      {comparing && before ? (
        <Compare before={before} after={after} />
      ) : job ? (
        <TakePlayer key={job.id} job={job} onRatio={() => {}} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={after} alt={asset?.label ?? ""} className="size-full bg-black object-contain" />
      )}
      {/* Measures the picture on show, so the tools know its size before anything is uploaded. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="" hidden onLoad={(e) => onSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
      {before && (
        <button
          onClick={() => setComparingId(comparing ? null : id)}
          aria-pressed={comparing}
          className={clsx(
            "absolute top-2 left-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] backdrop-blur",
            comparing ? "bg-tungsten text-black" : "bg-black/70 text-ink hover:bg-black",
          )}
        >
          <Columns2 size={13} />
          {tr("Compare")}
        </button>
      )}
    </div>
  );
}

/**
 * Before and after, one over the other. Pictures of the same shape split at a handle you drag;
 * a widened frame doesn't line up, so it shows the two side by side instead.
 */
export function Compare({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(0.5);
  const [ratios, setRatios] = useState<{ before?: number; after?: number }>({});
  const box = useRef<HTMLDivElement>(null);
  const same = ratios.before && ratios.after ? Math.abs(ratios.before / ratios.after - 1) < 0.03 : true;
  // Read now: the event's element is gone by the time a state updater runs.
  const measure = (side: "before" | "after", img: HTMLImageElement) => {
    const r = img.naturalWidth / Math.max(1, img.naturalHeight);
    setRatios((old) => ({ ...old, [side]: r }));
  };
  const move = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setSplit(Math.min(1, Math.max(0, (x - r.left) / r.width)));
  };

  if (!same)
    return (
      <div className="grid size-full grid-cols-2 gap-2 bg-black">
        {[
          { src: before, label: "Before" },
          { src: after, label: "After" },
        ].map((p) => (
          <figure key={p.label} className="relative flex min-h-0 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={tr(p.label)} className="max-h-full max-w-full object-contain" />
            <figcaption className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 text-[11px]">{tr(p.label)}</figcaption>
          </figure>
        ))}
      </div>
    );

  return (
    <div className="size-full bg-black">
      {/* Both pictures are contained in the same box, so pictures of one shape line up exactly. */}
      <div
        ref={box}
        className="relative size-full cursor-ew-resize touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && move(e.clientX)}
        role="slider"
        aria-label={tr("Before and after")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSplit((s) => Math.max(0, s - 0.05));
          if (e.key === "ArrowRight") setSplit((s) => Math.min(1, s + 0.05));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt={tr("After")} draggable={false} onLoad={(e) => measure("after", e.currentTarget)} className="block size-full object-contain" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={before}
          alt={tr("Before")}
          draggable={false}
          onLoad={(e) => measure("before", e.currentTarget)}
          className="absolute inset-0 size-full object-contain"
          style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
        />
        <span className="pointer-events-none absolute inset-y-0 w-[2px] bg-tungsten" style={{ left: `calc(${split * 100}% - 1px)` }} />
        <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 text-[11px]">{tr("Before")}</span>
        <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/70 px-1.5 text-[11px]">{tr("After")}</span>
      </div>
    </div>
  );
}

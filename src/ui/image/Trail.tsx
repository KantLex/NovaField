"use client";

// A picture's versions in order: the original, then every edit, upscale and expand made from it.
// Click one to show it and work on from there.

import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { isLive, type Job } from "@/lib/jobs";
import { useLive } from "../state";
import { useLab, type Version } from "./state";
import { tr } from "@/i18n";

const stepLabel = (j: Job) => {
  if (j.spec.kind !== "image") return tr("Original");
  if (j.spec.tool === "upscale") return tr("Upscale ×{n}", { n: j.spec.scale ?? 2 });
  if (j.spec.tool === "expand") return tr("Expand {aspect}", { aspect: j.spec.aspect ?? "16:9" });
  return tr("Edit");
};

export function Trail({ list, current }: { list: Version[]; current: string | null }) {
  const setFocus = useLive((s) => s.setFocus);
  if (list.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-panel px-3 py-2">
      <span className="text-[12px] text-dim">{tr("Versions of this picture")}</span>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {list.map((v, i) => {
          const j = v.job;
          const src = j ? (j.image ?? j.poster ?? (j.spec.kind === "image" ? j.spec.image.url : undefined)) : v.asset?.url;
          const active = current === (j?.id ?? v.key);
          return (
            <Fragment key={v.key}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-faint" />}
              <button
                onClick={() => {
                  if (j) return setFocus(j.id);
                  useLab.getState().set({ asset: v.asset ?? null });
                  setFocus(null);
                }}
                title={j?.title ?? v.asset?.label}
                className={clsx(
                  "group flex w-[92px] shrink-0 flex-col gap-1 rounded-[4px] p-1 text-left transition-colors",
                  active ? "bg-raised shadow-[0_0_0_1px_var(--color-tungsten)]" : "hover:bg-raised",
                )}
              >
                <span className="relative block aspect-[4/3] overflow-hidden rounded-[3px] bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {src && <img src={src} alt="" className={clsx("size-full object-cover", j && isLive(j) && "opacity-40")} />}
                  {j && isLive(j) && (
                    <span className="absolute inset-x-1 bottom-1 h-[2px] bg-white/15">
                      <span className="block h-full bg-tally" style={{ width: `${Math.round(j.progress.pct * 100)}%` }} />
                    </span>
                  )}
                  {j?.status === "failed" && <span className="absolute inset-0 flex items-center justify-center bg-tally/30 text-[11px]">{tr("Failed")}</span>}
                </span>
                <span className="truncate text-[11px] text-dim group-hover:text-ink">{j ? stepLabel(j) : tr("Original")}</span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

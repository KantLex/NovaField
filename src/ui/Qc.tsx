"use client";

// Shot QC on a take: a warning on thumbnails that need a second look, and under the player the
// faults found, each one a jump to the moment it happens.

import clsx from "clsx";
import { CircleCheck, LoaderCircle, ScanSearch, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { timecode } from "@/lib/engines/sizing";
import type { Job } from "@/lib/jobs";
import { issueTime, needsLook, QC_LABEL, type QcReport } from "@/lib/qc";
import { api, fail } from "./api";
import { Menu, MenuItem } from "./Menu";
import { useLive } from "./state";
import { tr } from "@/i18n";

const SEEK = "nf:seek";

/** Asks the player showing take `id` to jump to `t` seconds and hold there. */
export const seekTake = (id: string, t: number) => window.dispatchEvent(new CustomEvent(SEEK, { detail: { id, t } }));

/** Lets a player follow seekTake() calls for its take. */
export function onSeek(id: string, go: (t: number) => void) {
  const listen = (e: Event) => {
    const d = (e as CustomEvent<{ id: string; t: number }>).detail;
    if (d?.id === id) go(d.t);
  };
  window.addEventListener(SEEK, listen);
  return () => window.removeEventListener(SEEK, listen);
}

const summary = (r: QcReport) =>
  r.issues.length ? r.issues.map((i) => tr(QC_LABEL[i.kind].label)).filter((l, n, all) => all.indexOf(l) === n).join(", ") : tr("No faults found");

/** A thumbnail's warning: shown only when the take needs a second look. */
export function QcBadge({ job, small }: { job: Job; small?: boolean }) {
  const r = job.qc;
  if (!r || !needsLook(r)) return null;
  return (
    <span
      className={clsx("absolute flex items-center gap-0.5 rounded bg-tally font-semibold text-black", small ? "top-1 right-5 px-1 text-[10px]" : "top-1.5 right-7 px-1.5 text-[11px]")}
      title={`${tr("Shot QC {score}/100", { score: r.score })}: ${summary(r)}`}
    >
      <TriangleAlert size={small ? 10 : 11} strokeWidth={2.5} aria-hidden />
      {r.score}
    </span>
  );
}

/** Under the player: the take's QC result and its faults, or a button to check it. */
export function QcMenu({ job }: { job: Job }) {
  const canCheck = useLive((s) => !!s.status?.caps?.pack?.shotQc);
  const [busy, setBusy] = useState(false);
  const r = job.qc;
  if (!job.video || job.status !== "done" || (!r && !canCheck)) return null;
  const check = async () => {
    setBusy(true);
    try {
      await api.checkTake(job.id);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (!r)
    return (
      <button onClick={() => void check()} disabled={busy} title={tr("Look for frozen frames, jumps, flicker, soft frames and exposure problems")} className="mr-1 flex items-center gap-1.5 rounded-md bg-raised px-2.5 py-1 text-[13px] text-ink hover:bg-hover disabled:opacity-50">
        {busy ? <LoaderCircle size={14} className="animate-spin" /> : <ScanSearch size={14} />}
        {tr("Check take")}
      </button>
    );
  const bad = needsLook(r);
  const fps = r.fps || 24;
  return (
    <Menu
      label={tr("Shot QC")}
      trigger={() => (
        <span
          className={clsx("mr-1 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]", bad ? "bg-tally/20 text-tally hover:bg-tally/30" : "bg-raised text-ink hover:bg-hover")}
          title={summary(r)}
        >
          {bad ? <TriangleAlert size={14} /> : <CircleCheck size={14} className="text-tungsten" />}
          {r.issues.length ? tr("QC {score} · {n} to check", { score: r.score, n: r.issues.length }) : tr("QC {score}", { score: r.score })}
        </span>
      )}
    >
      {(close) => (
        <div className="flex w-[300px] flex-col">
          {r.issues.length === 0 && <p className="px-2 py-1.5 text-[13px] text-dim">{tr("No faults found: no frozen frames, jumps, flicker or soft frames.")}</p>}
          {r.issues.map((i, n) => (
            <MenuItem
              key={n}
              onClick={() => {
                close();
                seekTake(job.id, issueTime(r, i));
              }}
            >
              <span className={clsx("size-2 shrink-0 rounded-full", i.severity === "high" ? "bg-tally" : i.severity === "medium" ? "bg-tungsten" : "bg-dim")} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{tr(QC_LABEL[i.kind].label)}</span>
                <span className="text-[11px] text-faint">{tr(QC_LABEL[i.kind].note)}</span>
              </span>
              <span className="readout text-[12px] text-dim">{i.end > i.start && i.end < r.frames - 1 ? `${timecode(i.start, fps)}–${timecode(i.end, fps)}` : i.start === 0 && i.end >= r.frames - 1 ? tr("Whole take") : timecode(i.start, fps)}</span>
            </MenuItem>
          ))}
          <div className="my-1 border-t border-line" />
          <MenuItem
            onClick={() => {
              close();
              void check();
            }}
          >
            <ScanSearch size={14} />
            <span className="flex-1">{tr("Check again")}</span>
          </MenuItem>
        </div>
      )}
    </Menu>
  );
}

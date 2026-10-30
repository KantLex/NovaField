"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { Job } from "@/lib/jobs";
import { clipFor, normalize, type Clip, type Source } from "@/lib/sequence";
import { fail, request } from "./api";
import { useProjects } from "./projects";
import { sequenceKey, useLive, useStudio } from "./state";

// The edit lives on the server (data/sequences.json), so agents and other tabs share it. This
// tab keeps a copy, saves each change, and takes changes made elsewhere from the live feed.
const ORIGIN = Math.random().toString(36).slice(2, 10);

const useEdits = create<{ edits: Record<string, Clip[]> }>(() => ({ edits: {} }));

function saveEdit(key: string, clips: Clip[]) {
  useEdits.setState((s) => ({ edits: { ...s.edits, [key]: clips } }));
  return request<{ clips?: Clip[] }>(`/api/sequences/${encodeURIComponent(key)}`, { method: "PUT", json: { clips, origin: ORIGIN } }).then((body) => {
    // Take the server's version (plain take ids become clips with fixed ids), unless this tab has
    // already moved on to a newer edit.
    if (body.clips && useEdits.getState().edits[key] === clips) useEdits.setState((s) => ({ edits: { ...s.edits, [key]: body.clips! } }));
  });
}

/** Puts a finished take at the end of the current project's edit. */
export function appendToEdit(job: Job) {
  const key = sequenceKey(useProjects.getState().current);
  const jobs = useLive.getState().jobs;
  const clips = normalize(useEdits.getState().edits[key] ?? [], (t) => sourceOf(jobs[t]));
  return saveEdit(key, [...clips, clipFor(job.id, sourceOf(job))]);
}

/** Every edit, from the live feed when it (re)connects. Edits saved in this browser before move to the server once. */
export function receiveEdits(all: Record<string, Clip[]>) {
  useEdits.setState({ edits: all });
  const legacy = useStudio.getState().sequences;
  // Only into empty slots: an edit already on the server (an agent's, another browser's) wins, and
  // the local one stays put rather than being lost.
  const moving = Object.entries(legacy).filter(([key, raw]) => !all[key]?.length || !raw?.length);
  if (!moving.length) return;
  // The server turns plain take ids into clips; nothing is cleared until every save has landed.
  void Promise.all(moving.filter(([, raw]) => raw?.length).map(([key, raw]) => saveEdit(key, raw as Clip[])))
    .then(() => useStudio.setState((s) => ({ sequences: Object.fromEntries(Object.entries(s.sequences).filter(([key]) => !moving.some(([k]) => k === key))) })))
    .catch(fail);
}

/** One edit changed on the server; this tab's own saves come back too and are skipped. */
export function receiveEdit(change: { key: string; clips: Clip[]; origin: string | null }) {
  if (change.origin === ORIGIN) return;
  useEdits.setState((s) => ({ edits: { ...s.edits, [change.key]: change.clips } }));
}

// Lengths read from the files themselves, for takes whose metadata doesn't say (some workflows).
const measured = new Map<string, number>();
const listeners = new Set<() => void>();

function measure(job: Job) {
  if (!job.video || measured.has(job.id)) return;
  measured.set(job.id, 0);
  const v = document.createElement("video");
  v.preload = "metadata";
  v.src = job.video;
  v.onloadedmetadata = () => {
    measured.set(job.id, Number.isFinite(v.duration) ? v.duration : 0);
    v.removeAttribute("src");
    for (const l of listeners) l();
  };
}

/** How long a take runs and at what rate, from its metadata or its file. */
export function sourceOf(job: Job | undefined): Source | undefined {
  if (!job?.video) return undefined;
  const seconds = (job.meta?.seconds ?? 0) > 0 ? job.meta!.seconds : (measured.get(job.id) ?? 0);
  return { seconds, fps: job.meta?.fps || 24, trimHead: job.meta?.trimHead ?? 0 };
}

/** Re-render when a take's length has been read from its file. */
function useMeasured(jobs: Job[]) {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    for (const j of jobs) if (!((j.meta?.seconds ?? 0) > 0)) measure(j);
    return () => void listeners.delete(l);
  }, [jobs]);
}

const usable = (j: Job | undefined): j is Job => !!j && j.status === "done" && !!j.video;

/** Clips with an unknown end (length not known when added) run to the end of their take. */
const filled = (clips: Clip[], jobs: Record<string, Job>) =>
  clips.map((c) => {
    const s = sourceOf(jobs[c.take]);
    return c.out > c.in || !s?.seconds ? c : { ...c, out: s.seconds };
  });

/** The edit of the project being worked in: its clips (finished takes only) and a setter. */
export function useSequence(): [Clip[], (next: Clip[]) => void] {
  const key = sequenceKey(useProjects((s) => s.current));
  const raw = useEdits((s) => s.edits[key]);
  const jobs = useLive((s) => s.jobs);
  const takes = useMemo(() => Object.values(jobs).filter(usable), [jobs]);
  useMeasured(takes);
  const clips = useMemo(() => filled(normalize(raw ?? [], (t) => sourceOf(jobs[t])), jobs).filter((c) => usable(jobs[c.take])), [raw, jobs]);
  return [clips, (next) => void saveEdit(key, next).catch(fail)];
}

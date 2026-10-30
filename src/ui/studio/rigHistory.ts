"use client";

import { create } from "zustand";
import type { CustomRig } from "@/lib/cinema/custom";
import { useStudio } from "../state";

type Snapshot = CustomRig | null;

interface History {
  past: Snapshot[];
  future: Snapshot[];
  /** When the last edit was recorded; edits close together (a drag, a slider) undo as one step. */
  last: number;
}

/** Undo and redo for the Plan view's rig: every edit records the rig it replaced. */
export const useRigHistory = create<History>(() => ({ past: [], future: [], last: 0 }));

const current = () => useStudio.getState().shot.rig ?? null;

/** Call before changing the rig. `fresh` starts a new undo step even if the last edit was moments ago. */
export function recordRig(fresh = false) {
  const now = performance.now();
  const h = useRigHistory.getState();
  if (!fresh && now - h.last < 500) return useRigHistory.setState({ last: now });
  useRigHistory.setState({ past: [...h.past, current()].slice(-60), future: [], last: now });
}

export function undoRig() {
  const h = useRigHistory.getState();
  if (!h.past.length) return;
  const prev = h.past[h.past.length - 1];
  useRigHistory.setState({ past: h.past.slice(0, -1), future: [current(), ...h.future], last: 0 });
  useStudio.getState().patch({ rig: prev });
}

export function redoRig() {
  const h = useRigHistory.getState();
  if (!h.future.length) return;
  const [next, ...rest] = h.future;
  useRigHistory.setState({ past: [...h.past, current()], future: rest, last: 0 });
  useStudio.getState().patch({ rig: next });
}

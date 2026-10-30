"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CustomRig } from "@/lib/cinema/custom";
import type { Capabilities } from "@/lib/engines/capabilities";
import { NO_CAPABILITIES } from "@/lib/engines/capabilities";
import type { Asset, FilmLab, ShotSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import type { Clip } from "@/lib/sequence";

export interface ServerStatus {
  url: string;
  mode: "local" | "cloud";
  online: boolean;
  dryRun: boolean;
  apiKey: boolean;
  version: string | null;
  gpu: { name: string; vramFree: number; vramTotal: number } | null;
  queue: { running: number; pending: number } | null;
  nodeCount: number;
  caps: Capabilities;
}

interface Live {
  jobs: Record<string, Job>;
  status: ServerStatus | null;
  connected: boolean;
  /** The take shown on the studio monitor. */
  focus: string | null;
  setFocus: (id: string | null) => void;
  setSnapshot: (jobs: Job[]) => void;
  upsert: (job: Job) => void;
  remove: (id: string) => void;
  setStatus: (s: ServerStatus) => void;
  setConnected: (c: boolean) => void;
}

export const useLive = create<Live>((set) => ({
  jobs: {},
  status: null,
  connected: false,
  focus: null,
  setFocus: (focus) => set({ focus }),
  setSnapshot: (jobs) => {
    set({ jobs: Object.fromEntries(jobs.map((j) => [j.id, j])) });
    dropMissingExtend();
  },
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  remove: (id) => {
    set((s) => {
      const jobs = { ...s.jobs };
      delete jobs[id];
      return { jobs, focus: s.focus === id ? null : s.focus };
    });
    dropMissingExtend();
  },
  setStatus: (status) => set({ status }),
  setConnected: (connected) => set({ connected }),
}));

/** "Continue this take" saved from an earlier visit, for a take that's gone: stop continuing it. */
function dropMissingExtend() {
  const from = useStudio.getState().shot.extendFrom;
  if (from && !useLive.getState().jobs[from]) useStudio.getState().patch({ extendFrom: null });
}

export const caps = () => useLive.getState().status?.caps ?? NO_CAPABILITIES;

export const DEFAULT_FILM: FilmLab = {
  look: "kodak_2383",
  intensity: 0.75,
  grain: 0.35,
  halation: 0.3,
  vignette: 0.25,
  chromatic: 0.1,
  gateWeave: 0.15,
  streak: 0,
};

export type ShotDraft = Omit<ShotSpec, "kind" | "seed" | "extend"> & {
  takes: number;
  lockSeed: number | null;
  /** Continue from the end of this take (seamless extend). */
  extendFrom: string | null;
};

export const DEFAULT_SHOT: ShotDraft = {
  prompt: "",
  cast: [],
  size: "medium",
  angle: "eye",
  lens: 35,
  move: "push_in",
  intensity: 1,
  rig: null,
  combo: null,
  engine: null,
  timing: "auto",
  shake: 0,
  cameraMode: "rig",
  previs: null,
  rigStyle: "subject",
  lighting: "natural",
  film: DEFAULT_FILM,
  filmOnGpu: true,
  aspect: "16:9",
  quality: "draft",
  duration: 5,
  turbo: true,
  smooth: false,
  sound: true,
  takes: 1,
  lockSeed: null,
  extendFrom: null,
};

interface Studio {
  shot: ShotDraft;
  patch: (p: Partial<ShotDraft>) => void;
  addCast: (a: Asset) => void;
  updateCast: (i: number, p: Partial<Asset>) => void;
  removeCast: (i: number) => void;
  reset: () => void;
  /**
   * Edits saved in this browser before they moved to the server (data/sequences.json), per project
   * ("all" when none is chosen); older ones hold plain take ids. Moved there once, then emptied.
   */
  sequences: Record<string, (Clip | string)[]>;
  setSequenceFor: (key: string, clips: Clip[]) => void;
  /** Camera moves shaped in the Plan view and saved by name, with their stand-ins and set pieces. */
  savedMoves: SavedMove[];
  saveMove: (name: string, rig: CustomRig) => void;
  removeMove: (id: string) => void;
}

export interface SavedMove {
  id: string;
  name: string;
  rig: CustomRig;
}

export const useStudio = create<Studio>()(
  persist(
    (set) => ({
      shot: DEFAULT_SHOT,
      patch: (p) => set((s) => ({ shot: { ...s.shot, ...p } })),
      addCast: (a) => set((s) => ({ shot: { ...s.shot, cast: [...s.shot.cast, a].slice(0, 9) } })),
      updateCast: (i, p) => set((s) => ({ shot: { ...s.shot, cast: s.shot.cast.map((c, j) => (j === i ? { ...c, ...p } : c)) } })),
      removeCast: (i) => set((s) => ({ shot: { ...s.shot, cast: s.shot.cast.filter((_, j) => j !== i) } })),
      reset: () => set({ shot: DEFAULT_SHOT }),
      sequences: {},
      setSequenceFor: (key, clips) => set((s) => ({ sequences: { ...s.sequences, [key]: clips } })),
      savedMoves: [],
      saveMove: (name, rig) => set((s) => ({ savedMoves: [{ id: crypto.randomUUID(), name, rig: { ...rig, name } }, ...s.savedMoves].slice(0, 24) })),
      removeMove: (id) => set((s) => ({ savedMoves: s.savedMoves.filter((m) => m.id !== id) })),
    }),
    {
      name: "novafield-studio",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      merge: (persisted, current) => {
        const p = persisted as (Partial<Studio> & { sequence?: string[] }) | undefined;
        // Before projects there was one sequence; it becomes the "all projects" one.
        const sequences = p?.sequences ?? (p?.sequence?.length ? { all: p.sequence } : {});
        // Nested settings merge too, so a setting added since the last visit gets its default.
        const shot = { ...DEFAULT_SHOT, ...(p?.shot ?? {}) };
        shot.film = { ...DEFAULT_SHOT.film, ...(p?.shot?.film ?? {}) };
        return { ...current, ...p, sequences, shot };
      },
    },
  ),
);

export const randomSeed = () => Math.floor(Math.random() * 2 ** 47);

/** The sequence for the project being worked in, and a setter for it. */
export const sequenceKey = (current: string | null) => current ?? "all";

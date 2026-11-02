"use client";

// Henshin's working state: the chosen mode, its inputs, and the transform kinds it shows.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { LOOKS } from "@/lib/cinema/looks";
import { henshinModel, type HenshinModel, type HenshinModelInfo } from "@/lib/engines/henshinModels";
import type { Asset, BoxKey, PathPoint, PathTiming, Quality } from "@/lib/engines/specs";

export type Mode = "recast" | "restyle" | "replace" | "paths";

export const MODES: { id: Mode; label: string; verb: string; blurb: string }[] = [
  { id: "recast", label: "Recast", verb: "Recast", blurb: "Swap the person in a clip for your character. Motion, timing and camera stay." },
  { id: "restyle", label: "Restyle", verb: "Restyle", blurb: "Re-render a clip in a new look, shot for shot." },
  { id: "replace", label: "Replace", verb: "Replace", blurb: "Track an object with a box and swap it for something else." },
  { id: "paths", label: "Motion paths", verb: "Animate", blurb: "Draw where things should move on a still, and it comes alive." },
];

export interface G {
  mode: Mode;
  /** The model chosen for each mode: a built-in one, or "wf:<id>" for an imported workflow. Unset: the mode's default. */
  models: Partial<Record<Mode, HenshinModel | `wf:${string}`>>;
  h3Source?: Asset;
  wanSource?: Asset;
  character?: Asset;
  /** Recast: who in the clip changes, clicked on a frame (0–1, and the time in seconds). Unset: the main person. */
  target?: { x: number; y: number; t: number };
  extras: Asset[];
  notes: string;
  style: string;
  styleRef?: Asset;
  look: (typeof LOOKS)[number]["id"];
  audio: "original" | "generated" | "none";
  quality: Quality;
  keys: BoxKey[];
  shape: "rect" | "ellipse";
  replacement?: Asset;
  replacePrompt: string;
  still?: Asset;
  paths: PathPoint[][];
  pathTiming: PathTiming[];
  pathPrompt: string;
  set: (p: Partial<G>) => void;
}

export const useG = create<G>()(
  persist(
    (set) => ({
      mode: "recast",
      models: {},
      extras: [],
      notes: "",
      style: "",
      look: "none",
      audio: "original",
      quality: "draft",
      keys: [],
      shape: "ellipse",
      replacePrompt: "",
      paths: [],
      pathTiming: [],
      pathPrompt: "",
      set: (p) => set(p),
    }),
    {
      name: "novafield-henshin",
      // Henshin was called Genjutsu: its saved state moves over on the first save.
      storage: createJSONStorage(() => ({
        getItem: (k) => localStorage.getItem(k) ?? localStorage.getItem("novafield-genjutsu"),
        setItem: (k, v) => (localStorage.setItem(k, v), localStorage.removeItem("novafield-genjutsu")),
        removeItem: (k) => localStorage.removeItem(k),
      })),
      partialize: (s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "set")) as unknown as G,
    },
  ),
);

export const KINDS = ["recast" as const, "restyle" as const, "replace" as const, "paths" as const];

/** The imported workflow the current mode runs through, if one was chosen. */
export const workflowOf = (g: Pick<G, "mode" | "models">): string | null => {
  const m = g.models[g.mode];
  return m?.startsWith("wf:") ? m.slice(3) : null;
};

/** What a workflow takes and gives, as far as the page is concerned: H3's clip (or the still), and no sound or quality of ours. */
const workflowInfo = (mode: Mode): HenshinModelInfo => ({
  id: "workflow",
  name: "",
  blurb: "",
  recommended: false,
  clip: mode === "paths" ? "image" : "h3",
  sound: false,
  quality: false,
  files: [],
});

/** The model the current mode runs on. */
export const modelOf = (g: Pick<G, "mode" | "models">): HenshinModelInfo => (workflowOf(g) ? workflowInfo(g.mode) : henshinModel(g.mode, g.models[g.mode]));

/** The clip the current mode works on: H3's or Wan's, whichever its model takes. */
export const clipOf = (g: Pick<G, "mode" | "models" | "h3Source" | "wanSource">): Asset | undefined => (modelOf(g).clip === "h3" ? g.h3Source : g.wanSource);

/**
 * What a new clip (or another part of one) for `purpose` clears: who to recast and the box track,
 * when they were set on a clip of that kind. Other people and things are elsewhere in it.
 */
export const clearedBy = (g: Pick<G, "models">, purpose: "h3" | "wan"): Partial<G> => ({
  ...(modelOf({ mode: "recast", models: g.models }).clip === purpose ? { target: undefined } : {}),
  ...(modelOf({ mode: "replace", models: g.models }).clip === purpose ? { keys: [] } : {}),
});

"use client";

// Henshin's working state: the chosen mode, its inputs, and the transform kinds it shows.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { LOOKS } from "@/lib/cinema/looks";
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
  h3Source?: Asset;
  wanSource?: Asset;
  character?: Asset;
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

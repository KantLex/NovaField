"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { InputValue } from "@/lib/comfy/graph";
import type { RecipeSummary } from "@/lib/workflows/types";
import { request } from "../api";

interface Recipes {
  list: RecipeSummary[];
  loaded: boolean;
  refresh: () => Promise<void>;
  upsert: (r: RecipeSummary) => void;
  drop: (id: string) => void;
}

export const useRecipes = create<Recipes>((set) => ({
  list: [],
  loaded: false,
  refresh: async () => {
    try {
      const list = await request<RecipeSummary[]>("/api/workflows");
      set({ list, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  upsert: (r) => set((s) => ({ list: [r, ...s.list.filter((x) => x.id !== r.id)] })),
  drop: (id) => set((s) => ({ list: s.list.filter((x) => x.id !== id) })),
}));

/** What the person typed into each workflow's form, kept between visits. */
export const useForms = create<{
  values: Record<string, Record<string, InputValue>>;
  /** Uploaded file name → preview URL. */
  uploads: Record<string, string>;
  set: (recipe: string, field: string, v: InputValue | undefined) => void;
  clear: (recipe: string) => void;
  remember: (name: string, url: string) => void;
}>()(
  persist(
    (set) => ({
      values: {},
      uploads: {},
      remember: (name, url) => set((s) => ({ uploads: { ...s.uploads, [name]: url } })),
      set: (recipe, field, v) =>
        set((s) => {
          const next = { ...(s.values[recipe] ?? {}) };
          if (v === undefined) delete next[field];
          else next[field] = v;
          return { values: { ...s.values, [recipe]: next } };
        }),
      clear: (recipe) => set((s) => ({ values: { ...s.values, [recipe]: {} } })),
    }),
    { name: "novafield-workflow-forms", storage: createJSONStorage(() => localStorage) },
  ),
);

/** Browser URL for a value in a media field: our own upload, or a file already on the server. */
export const mediaUrl = (value: InputValue, uploads: Record<string, string>) =>
  typeof value === "string" && value ? (uploads[value] ?? `/api/comfy-view?filename=${encodeURIComponent(value)}&type=input`) : null;

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Job } from "@/lib/jobs";
import { UNSORTED, type Project } from "@/lib/projects";
import { request } from "./api";
import { flyTakes } from "./fly";

interface Projects {
  list: Project[];
  /** What the person is working in: a project id, UNSORTED, or null for everything. */
  current: string | null;
  setCurrent: (id: string | null) => void;
  setList: (list: Project[]) => void;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<Project>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  move: (ids: string[], project: string | null) => Promise<void>;
}

export const useProjects = create<Projects>()(
  persist(
    (set, get) => ({
      list: [],
      current: null,
      setCurrent: (current) => set({ current }),
      setList: (list) => {
        const c = get().current;
        // The project being viewed was deleted (maybe in another tab): fall back to everything.
        set({ list, current: c && c !== UNSORTED && !list.some((p) => p.id === c) ? null : c });
      },
      refresh: async () => get().setList(await request<Project[]>("/api/projects")),
      create: async (name) => {
        const p = await request<Project>("/api/projects", { json: { name } });
        set((s) => ({ list: [p, ...s.list.filter((x) => x.id !== p.id)] }));
        return p;
      },
      rename: async (id, name) => {
        const p = await request<Project>(`/api/projects/${id}`, { method: "PATCH", json: { name } });
        set((s) => ({ list: s.list.map((x) => (x.id === id ? p : x)) }));
      },
      remove: async (id) => {
        await request(`/api/projects/${id}`, { method: "DELETE" });
        get().setList(get().list.filter((p) => p.id !== id));
      },
      move: async (ids, project) => {
        flyTakes(ids, project);
        await request("/api/jobs/move", { json: { ids, project } });
      },
    }),
    { name: "novafield-project", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ current: s.current }) as Projects },
  ),
);

/** Whether a take shows in the given view. */
export const inView = (job: Job, view: string | null) => (view === null ? true : view === UNSORTED ? !job.project : job.project === view);

/** Where new takes go: the current project, or nowhere for "All" and "Unsorted". */
export const targetProject = () => {
  const c = useProjects.getState().current;
  return c && c !== UNSORTED ? c : null;
};

export function projectName(id: string | null | undefined, list: Project[]) {
  if (id === null || id === undefined) return "All projects";
  if (id === UNSORTED) return "Unsorted";
  return list.find((p) => p.id === id)?.name ?? "Unknown project";
}

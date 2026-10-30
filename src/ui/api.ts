"use client";

import { create } from "zustand";
import type { GraphPrice } from "@/lib/comfy/credits";
import type { Clip } from "@/lib/sequence";
import type { Asset, FilmLab, JobSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import type { QcReport } from "@/lib/qc";
import { targetProject } from "./projects";
import { tr } from "@/i18n";
import { shatter } from "./shatter";

/** A failed API call: the server's own message, plus the status and body for callers that branch on them (409 busy…). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // Server messages are English sentences made with say(); tr() finds them in the reader's language.
  if (!res.ok) throw new ApiError(typeof body.error === "string" ? tr(body.error) : tr("Request failed ({status}).", { status: res.status }), res.status, body);
  return body as T;
}

/**
 * Call the app's own API. `json` is sent as a JSON body (POST unless another method is given); the
 * reply is parsed, and a failure becomes an ApiError with the server's message.
 */
export async function request<T>(url: string, opts: { method?: string; json?: unknown; body?: BodyInit; signal?: AbortSignal } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.json !== undefined || opts.body !== undefined ? "POST" : "GET"), signal: opts.signal };
  if (opts.json !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(opts.json);
  } else if (opts.body !== undefined) init.body = opts.body;
  return json<T>(await fetch(url, init));
}

export type Purpose = "image" | "h3" | "wan" | "raw" | "track";

export const api = {
  submit: (specs: JobSpec[]) => request<Job[]>("/api/jobs", { json: { specs, project: targetProject() } }),
  cancel: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  remove: (id: string) => {
    const restore = shatter(`[data-take="${CSS.escape(id)}"]`);
    return request<{ ok: true }>(`/api/jobs/${id}`, { method: "DELETE" }).catch((e) => {
      restore();
      throw e;
    });
  },
  favorite: (id: string, favorite: boolean) => request<Job>(`/api/jobs/${id}`, { method: "PATCH", json: { favorite } }),
  rename: (id: string, title: string) => request<Job>(`/api/jobs/${id}`, { method: "PATCH", json: { title } }),
  lastFrame: (id: string) => request<Asset>(`/api/jobs/${id}/frame`, { method: "POST" }),
  /** A frame of a video take as a picture: the moment `at` seconds in, or the last frame. */
  frame: (id: string, at?: number) => request<Asset>(`/api/jobs/${id}/frame`, at === undefined ? { method: "POST" } : { json: { at } }),
  /** A finished take, made ready for a purpose like an uploaded file. */
  /** Shot QC: check a finished clip for faults; the report lands on the take. */
  checkTake: (id: string) => request<QcReport>(`/api/jobs/${id}/qc`, { method: "POST" }),
  /** One frame through the real film grade on the GPU (the grade tool's exact check). */
  gradeFrame: (image: string, film: FilmLab, seed: number) => request<{ url: string }>("/api/grade/preview", { json: { image, film, seed } }),
  useTake: (id: string, purpose: Purpose) => request<Asset>(`/api/jobs/${id}/use`, { json: { purpose } }),
  upload: (file: File, purpose: Purpose) => {
    const form = new FormData();
    form.append("file", file);
    form.append("purpose", purpose);
    return request<Asset>("/api/upload", { body: form });
  },
  preflight: (spec: JobSpec) =>
    request<{
      meta: Job["meta"];
      nodes: number;
      issues: { classType: string; input?: string; message: string }[];
      warnings: { classType: string; input?: string; message: string }[];
      paid: string[];
      price: GraphPrice | null;
      blocker: string | null;
    }>("/api/preflight", { json: { spec } }),
  assemble: (clips: Clip[], title?: string) => request<{ id: string; url: string; title: string }>("/api/films", { json: { clips, title } }),
};

export interface Toast {
  id: number;
  tone: "info" | "error" | "done";
  text: string;
}

export const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; drop: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === "error" ? 9000 : 4500);
  },
  drop: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Show a message; fixed English text is translated (messages built with tr() pass through unchanged). */
export const toast = (text: string, tone: Toast["tone"] = "info") => useToasts.getState().push({ text: tr(text), tone });
export const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "error");

/** One pack install's progress in ComfyUI Manager. */
export type PackTask = { state: "waiting" | "done" | "failed"; message?: string };

/** Installing node packs through ComfyUI Manager, and restarting ComfyUI to load them. */
export const packs = {
  status: (tasks: Record<string, string>) => request<Record<string, PackTask>>("/api/packs/status", { json: { tasks } }),
  install: (list: { id: string; registry?: unknown; repository?: unknown }[]) => request<{ tasks: Record<string, string> }>("/api/packs/install", { json: { packs: list } }),
  /** Restart ComfyUI. Resolves to how many jobs (others' included) a restart would stop when it's busy and not forced, else null. */
  restart: async (force: boolean): Promise<number | null> => {
    try {
      await request("/api/packs/restart", { json: { force } });
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return Number(e.body.busy) || 1;
      throw e;
    }
  },
};


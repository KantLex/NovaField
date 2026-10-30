"use client";

import { create } from "zustand";
import type { AssetEntry, AssetKind, Purpose } from "@/lib/assets";
import type { Asset } from "@/lib/engines/specs";
import { request } from "../api";
import { shatter } from "../shatter";


interface Assets {
  list: AssetEntry[];
  loaded: boolean;
  setList: (list: AssetEntry[]) => void;
  refresh: () => Promise<void>;
  create: (p: { name: string; kind: AssetKind; description?: string }) => Promise<AssetEntry>;
  update: (id: string, p: Partial<Pick<AssetEntry, "name" | "kind" | "description" | "cover" | "favorite">> & { order?: string[]; labels?: Record<string, string> }) => Promise<AssetEntry>;
  remove: (id: string) => Promise<void>;
  addFiles: (id: string, files: File[]) => Promise<AssetEntry>;
  /** Files NovaField already has: a take's video or image, an upload. */
  addUrls: (id: string, urls: string[]) => Promise<AssetEntry>;
  /** Null when that was the asset's last file: the asset is gone too. */
  removeItem: (id: string, item: string) => Promise<AssetEntry | null>;
}

const upsert = (list: AssetEntry[], e: AssetEntry) => (list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [e, ...list]);

/** The asset library, kept live by the event stream (another tab's edits show up here too). */
export const useAssets = create<Assets>()((set, get) => ({
  list: [],
  loaded: false,
  setList: (list) => set({ list, loaded: true }),
  refresh: async () => get().setList(await request<AssetEntry[]>("/api/assets")),
  create: async (p) => {
    const e = await request<AssetEntry>("/api/assets", { json: p });
    set({ list: upsert(get().list, e) });
    return e;
  },
  update: async (id, p) => {
    const e = await request<AssetEntry>(`/api/assets/${id}`, { method: "PATCH", json: p });
    set({ list: upsert(get().list, e) });
    return e;
  },
  remove: async (id) => {
    const restore = shatter(`[data-asset="${CSS.escape(id)}"]`);
    await request(`/api/assets/${id}`, { method: "DELETE" }).catch((e) => {
      restore();
      throw e;
    });
    set({ list: get().list.filter((x) => x.id !== id) });
  },
  addFiles: async (id, files) => {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    const e = await request<AssetEntry>(`/api/assets/${id}/items`, { body: form });
    set({ list: upsert(get().list, e) });
    return e;
  },
  addUrls: async (id, urls) => {
    const e = await request<AssetEntry>(`/api/assets/${id}/items`, { json: { urls } });
    set({ list: upsert(get().list, e) });
    return e;
  },
  removeItem: async (id, item) => {
    const restore = shatter(`[data-asset-item="${CSS.escape(item)}"]`);
    const e = await request<AssetEntry | { removed: true }>(`/api/assets/${id}/items?item=${encodeURIComponent(item)}`, { method: "DELETE" }).catch((err) => {
      restore();
      throw err;
    });
    if ("removed" in e) {
      set({ list: get().list.filter((x) => x.id !== id) });
      return null;
    }
    set({ list: upsert(get().list, e) });
    return e;
  },
}));

/** An asset's files (all, or some), conformed for a purpose and placed in ComfyUI. */
export const prepareAsset = (id: string, purpose: Purpose, items?: string[]) => request<Asset[]>("/api/assets/use", { json: { id, purpose, items } });

let loading: Promise<void> | null = null;

/** Load the library once (many callers share one request); the event stream keeps it current after that. */
export function ensureAssets() {
  const s = useAssets.getState();
  if (s.loaded || loading) return;
  loading = s.refresh().catch(() => {}).finally(() => (loading = null));
}

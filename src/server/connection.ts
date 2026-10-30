// Where NovaField sends its ComfyUI work: a ComfyUI on this machine or the network, or Comfy Cloud.
// Saved in data/connection.json from the Connection screen; COMFY_URL / COMFY_API_KEY in .env.local
// still work as the starting point. Keys stay on this machine and never go back to the browser.

import { readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { writeJson } from "./jsonFile";

export type ConnectionMode = "local" | "cloud";

export interface Connection {
  mode: ConnectionMode;
  /** The local ComfyUI, e.g. http://127.0.0.1:8188. Kept while on Cloud so switching back is one click. */
  url: string;
  /** Comfy Cloud API key (platform.comfy.org). Also pays for API nodes on Cloud. */
  cloudKey: string;
  /** Comfy account key for API nodes (GPT Image, Kling…) run on a local ComfyUI. */
  apiKey: string;
}

/** What the browser may see: never the keys themselves. */
export interface PublicConnection {
  mode: ConnectionMode;
  url: string;
  cloudKey: boolean;
  apiKey: boolean;
  source: "saved" | "env" | "default";
}

export const CLOUD_URL = "https://cloud.comfy.org";
export const DEFAULT_URL = "http://127.0.0.1:8188";
const FILE = path.join(DATA_DIR, "connection.json");

export const normalizeUrl = (url: string) => {
  const u = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
};

const fromEnv = (): Connection => ({
  mode: "local",
  url: normalizeUrl(process.env.COMFY_URL || DEFAULT_URL),
  cloudKey: "",
  apiKey: (process.env.COMFY_API_KEY ?? "").trim(),
});

function load(): { c: Connection; source: PublicConnection["source"] } {
  const env = fromEnv();
  try {
    const saved = JSON.parse(readFileSync(FILE, "utf8")) as Partial<Connection>;
    return {
      c: {
        mode: saved.mode === "cloud" ? "cloud" : "local",
        url: saved.url ? normalizeUrl(saved.url) : env.url,
        cloudKey: saved.cloudKey ?? "",
        apiKey: saved.apiKey ?? env.apiKey,
      },
      source: "saved",
    };
  } catch {
    return { c: env, source: process.env.COMFY_URL ? "env" : "default" };
  }
}

const g = globalThis as unknown as { __novaConnection?: ReturnType<typeof load> };
const state = () => (g.__novaConnection ??= load());

export const connection = (): Connection => state().c;
export const isCloud = () => connection().mode === "cloud";

/** Changes whenever the target server does, so caches of one server never answer for another. */
export const connectionId = () => (isCloud() ? "cloud" : connection().url);

export function publicConnection(): PublicConnection {
  const { c, source } = state();
  return { mode: c.mode, url: c.url, cloudKey: !!c.cloudKey, apiKey: !!c.apiKey, source };
}

export async function saveConnection(c: Connection) {
  await writeJson(FILE, c, { indent: 2, mode: 0o600 });
  g.__novaConnection = { c, source: "saved" };
}

/**
 * Full URL for a ComfyUI path. Cloud serves its API under /api; `raw` is for the frontend's
 * static files (templates and their previews), which sit at the root on both.
 */
export function comfyUrl(p: string, opts?: { raw?: boolean }, c = connection()) {
  if (c.mode !== "cloud") return `${c.url}${p}`;
  return `${CLOUD_URL}${opts?.raw || p.startsWith("/api/") ? "" : "/api"}${p}`;
}

export function comfyHeaders(init?: HeadersInit, c = connection()): Headers {
  const h = new Headers(init);
  if (c.mode === "cloud" && c.cloudKey) h.set("X-API-Key", c.cloudKey);
  return h;
}

export type ComfyInit = RequestInit & { timeoutMs?: number; raw?: boolean };

export function comfyFetch(p: string, init: ComfyInit = {}) {
  const { timeoutMs = 15_000, raw, ...rest } = init;
  return fetch(comfyUrl(p, { raw }), { ...rest, headers: comfyHeaders(rest.headers), signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * A file from /view. Cloud answers with a redirect to signed storage; follow it without the key,
 * so the key never leaves for another host.
 */
export async function comfyFile(p: string, init: { method?: string; timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 120_000, method } = init;
  if (!isCloud()) return fetch(comfyUrl(p), { method, signal: AbortSignal.timeout(timeoutMs) });
  const first = await fetch(comfyUrl(p), { method, headers: comfyHeaders(), redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  const to = first.status >= 300 && first.status < 400 ? first.headers.get("location") : null;
  if (!to) return first;
  return fetch(new URL(to, CLOUD_URL), { method, signal: AbortSignal.timeout(timeoutMs) });
}

export function wsUrl(clientId: string) {
  const c = connection();
  if (c.mode === "cloud") return `${CLOUD_URL.replace(/^http/, "ws")}/ws?clientId=${clientId}&token=${encodeURIComponent(c.cloudKey)}`;
  return `${c.url.replace(/^http/, "ws")}/ws?clientId=${clientId}`;
}

/** The Comfy account key ComfyUI's API nodes bill to: the Cloud key itself on Cloud. */
export const partnerKey = () => (isCloud() ? connection().cloudKey : connection().apiKey);

/** Why a connection doesn't work; the screen words it in the user's language. */
export type ConnectionProblem = "no-key" | "offline" | "bad-key" | "no-plan" | "cloud-error" | "waitlisted" | "no-comfy";

export interface ConnectionTest {
  ok: boolean;
  problem: ConnectionProblem | null;
  version: string | null;
  gpu: string | null;
}

/** Try a connection before saving it. */
export async function testConnection(c: Connection): Promise<ConnectionTest> {
  const get = (p: string) => fetch(comfyUrl(p, undefined, c), { headers: comfyHeaders(undefined, c), signal: AbortSignal.timeout(8000) });
  const stats = async () => {
    const res = await get("/system_stats");
    if (!res.ok) return null;
    return (await res.json()) as { system?: { comfyui_version?: string }; devices?: { name: string }[] };
  };
  const fail = (problem: ConnectionProblem): ConnectionTest => ({ ok: false, problem, version: null, gpu: null });

  if (c.mode === "cloud") {
    if (!c.cloudKey) return fail("no-key");
    const res = await get("/api/user").catch(() => null);
    if (!res) return fail("offline");
    if (res.status === 401) return fail("bad-key");
    // Signed in but not allowed: the key is fine, the plan isn't.
    if (res.status === 402 || res.status === 403) return fail("no-plan");
    if (!res.ok) return fail("cloud-error");
    const user = (await res.json().catch(() => ({}))) as { status?: string };
    // The API needs a paid plan; a key from a free account can sign in but not run.
    // Only its status matters: stop reading as soon as the headers are in (the body is several MB).
    const info = await get("/api/object_info").catch(() => null);
    await info?.body?.cancel().catch(() => {});
    if (info && (info.status === 402 || info.status === 403)) return fail("no-plan");
    const s = await stats().catch(() => null);
    return {
      ok: user.status !== "waitlisted",
      problem: user.status === "waitlisted" ? "waitlisted" : null,
      version: s?.system?.comfyui_version ?? null,
      gpu: "Comfy Cloud",
    };
  }

  const s = await stats().catch(() => null);
  if (!s) return fail("no-comfy");
  return {
    ok: true,
    problem: null,
    version: s.system?.comfyui_version ?? null,
    gpu: s.devices?.[0]?.name.replace(/^cuda:\d+\s*/, "").replace(/\s*:\s*\w+$/, "") ?? null,
  };
}

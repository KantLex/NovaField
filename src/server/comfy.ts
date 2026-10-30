// HTTP side of the ComfyUI API. The server is shared with other sessions, so this module
// never clears the queue or interrupts blindly: it only touches prompts NovaField queued.

import type { ApiGraph } from "@/lib/comfy/graph";
import type { ObjectInfo } from "@/lib/comfy/validate";
import { comfyFetch, connectionId, isCloud, partnerKey } from "./connection";
import { say } from "@/lib/say";

export interface FileRef {
  filename: string;
  subfolder: string;
  type: string;
}

async function call<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await comfyFetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ComfyError(say("ComfyUI {path} answered {status}", { path, status: res.status }), res.status, body);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export class ComfyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

// The node catalogue is 2 MB locally and several times that on Cloud, and it only changes when
// ComfyUI restarts (new packs) or the connection moves. So it's kept until then (the hub forgets it
// when the socket reconnects), refreshed in the background now and then, and fetched once for
// everyone asking at the same moment.
const REFRESH_MS = 15 * 60_000;
let infoCache: { at: number; id: string; info: ObjectInfo } | null = null;
let infoFetch: { id: string; p: Promise<ObjectInfo> } | null = null;

function fetchObjectInfo(id: string): Promise<ObjectInfo> {
  if (infoFetch?.id === id) return infoFetch.p;
  const p = call<ObjectInfo>("/object_info", { timeoutMs: 30_000 })
    .then((info) => {
      if (connectionId() === id) infoCache = { at: Date.now(), id, info };
      return info;
    })
    .finally(() => {
      if (infoFetch?.p === p) infoFetch = null;
    });
  infoFetch = { id, p };
  return p;
}

export async function objectInfo(force = false): Promise<ObjectInfo> {
  const id = connectionId();
  if (force || infoCache?.id !== id) return fetchObjectInfo(id);
  if (Date.now() - infoCache.at > REFRESH_MS) void fetchObjectInfo(id).catch(() => {});
  return infoCache.info;
}

/** ComfyUI restarted or the connection changed: read the catalogue again next time. */
export function forgetObjectInfo() {
  infoCache = null;
}

export interface SystemStats {
  system: { comfyui_version: string };
  devices: { name: string; vram_total: number; vram_free: number }[];
}

export const systemStats = () => call<SystemStats>("/system_stats", { timeoutMs: 4000 });

export interface QueueState {
  queue_running: [number, string, ...unknown[]][];
  queue_pending: [number, string, ...unknown[]][];
}

export const queueState = () => call<QueueState>("/queue", { timeoutMs: 5000 });

export async function queuePrompt(graph: ApiGraph, clientId: string): Promise<{ prompt_id: string; number: number }> {
  try {
    return await call("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // ComfyUI fills API nodes' hidden key input from extra_data and keeps it out of history.
      body: JSON.stringify({ prompt: graph, client_id: clientId, extra_data: { novafield: true, ...(partnerKey() ? { api_key_comfy_org: partnerKey() } : {}) } }),
    });
  } catch (e) {
    if (e instanceof ComfyError && e.status === 400) throw new Error(describePromptError(e.body));
    throw e;
  }
}

function describePromptError(body: string): string {
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string; details?: string };
      node_errors?: Record<string, { class_type: string; errors: { message: string; details: string }[] }>;
    };
    const nodes = Object.values(j.node_errors ?? {}).flatMap((n) => n.errors.map((e) => `${n.class_type}: ${e.message}${e.details ? ` (${e.details})` : ""}`));
    return [j.error?.message, ...nodes].filter(Boolean).join(" · ") || body;
  } catch {
    return body;
  }
}

export async function upload(data: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("image", data, filename);
  form.append("overwrite", "true");
  form.append("type", "input");
  const res = await call<{ name: string; subfolder: string }>("/upload/image", { method: "POST", body: form, timeoutMs: 120_000 });
  return res.subfolder ? `${res.subfolder}/${res.name}` : res.name;
}

export interface HistoryEntry {
  status?: { status_str: string; completed: boolean; messages?: [string, Record<string, unknown>][] };
  outputs: Record<string, { images?: FileRef[]; gifs?: FileRef[]; video?: FileRef[]; audio?: FileRef[]; animated?: boolean[]; text?: string[] }>;
}

/**
 * Waits for a prompt NovaField queued to finish and returns its history. Throws the server's own
 * message if it fails, or `busy` when it hasn't finished within the time allowed.
 */
export async function finished(promptId: string, timeoutMs: number, busy: string): Promise<HistoryEntry> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 400));
    const h = await history(promptId).catch(() => null);
    if (h?.status?.status_str === "error") {
      const msg = h.status.messages?.find(([k]) => k === "execution_error")?.[1] as { exception_message?: string } | undefined;
      throw new Error(msg?.exception_message ?? say("The render failed on the server."));
    }
    if (h?.status?.completed) return h;
  }
  // Take our own prompt back so it doesn't run later for nothing; never anyone else's.
  await cancelPrompt(promptId).catch(() => {});
  throw new Error(busy);
}

export async function history(promptId: string): Promise<HistoryEntry | null> {
  if (isCloud()) return cloudJob(promptId);
  const h = await call<Record<string, HistoryEntry>>(`/history/${promptId}`);
  return h[promptId] ?? null;
}

/** Comfy Cloud keeps no /history; its job record says the same in other words. */
async function cloudJob(promptId: string): Promise<HistoryEntry | null> {
  let job: { status: string; outputs?: HistoryEntry["outputs"]; execution_error?: { exception_message?: string } };
  try {
    job = await call(`/jobs/${promptId}`);
  } catch (e) {
    if (e instanceof ComfyError && e.status === 404) return null;
    throw e;
  }
  const status_str = job.status === "completed" ? "success" : job.status === "failed" ? "error" : job.status;
  return {
    status: {
      status_str,
      completed: job.status === "completed",
      messages: job.execution_error ? [["execution_error", job.execution_error]] : [],
    },
    outputs: job.outputs ?? {},
  };
}

// Saved files first, then temporary previews. Never "input": newer ComfyUI also lists the files
// that Load nodes read (a source clip, a reference picture), and those aren't results.
const PASSES = ["output", "temp"] as const;

function findOutput(entry: HistoryEntry, pick: (out: HistoryEntry["outputs"][string]) => FileRef[] | undefined, ext: RegExp): FileRef | null {
  const all = Object.values(entry.outputs);
  for (const pass of PASSES) {
    for (const out of all) {
      const f = (pick(out) ?? []).find((x) => (x.type ?? "output") === pass && ext.test(x.filename));
      if (f) return f;
    }
  }
  return null;
}

/** The video a finished prompt made. */
export function videoOutput(entry: HistoryEntry): FileRef | null {
  return findOutput(entry, (out) => [...(out.video ?? []), ...(out.images ?? []), ...(out.gifs ?? [])], /\.(mp4|webm|mkv|mov)$/i);
}

/** The main result of a finished prompt: a video if there is one, else an image, else audio. */
export function mainOutput(entry: HistoryEntry): { file: FileRef; kind: "video" | "image" | "audio" } | null {
  const v = videoOutput(entry);
  if (v) return { file: v, kind: "video" };
  const img = findOutput(entry, (out) => out.images, /\.(png|jpe?g|webp|gif)$/i);
  if (img) return { file: img, kind: "image" };
  const a = findOutput(entry, (out) => out.audio, /\.(flac|mp3|wav|ogg|opus|m4a)$/i);
  return a ? { file: a, kind: "audio" } : null;
}

/** The /view path of an output file; download it with comfyFile. */
export function viewPath(f: FileRef) {
  const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
  return `/view?${q}`;
}

/** Cancel one NovaField prompt: drop it if pending, interrupt it only if it is the one running. */
export async function cancelPrompt(promptId: string): Promise<"removed" | "interrupted" | "not-found"> {
  const q = await queueState();
  if (q.queue_pending.some((p) => p[1] === promptId)) {
    await call("/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ delete: [promptId] }) });
    return "removed";
  }
  // Cloud's interrupt stops every running job on the account, so only use it when ours is the only one.
  if (q.queue_running.some((p) => p[1] === promptId) && (!isCloud() || q.queue_running.length === 1)) {
    await call("/interrupt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt_id: promptId }) });
    return "interrupted";
  }
  return "not-found";
}

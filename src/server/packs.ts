// Missing nodes → the node packs that provide them, via ComfyUI Manager (v4, /v2 API) and the
// public Comfy Registry. Also queues installs and restarts ComfyUI through Manager.

import { randomUUID } from "node:crypto";
import { isDisplayOnly } from "@/lib/workflows/missing";
import { comfyFetch, isCloud } from "./connection";
import { say } from "@/lib/say";

export interface PackSuggestion {
  /** What Manager installs: a registry id, or "author/repo" for packs only on GitHub. */
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  repository: string | null;
  stars: number | null;
  /** In the Comfy Registry (vetted listing) rather than only a GitHub URL. */
  registry: boolean;
  /** The missing node types this pack provides. */
  covers: string[];
  /** Already on the server; its nodes are still missing, so it failed to load. */
  installed: boolean;
  /** Every node it would add here only shows values on the canvas. */
  displayOnly: boolean;
}

export interface PackPlan {
  manager: { available: boolean; version: string | null };
  packs: PackSuggestion[];
  /** Node types no known pack provides. */
  unknown: string[];
}


// Comfy Cloud runs a fixed set of node packs and has no Manager to install more.
const manager = async (path: string, init?: RequestInit) => {
  if (isCloud()) throw new Error(say("Comfy Cloud can't install node packs. Connect a local ComfyUI to add them."));
  return comfyFetch(`/v2${path}`, { ...init, timeoutMs: 60_000 });
};

let mappings: { at: number; data: Record<string, [string[], { title_aux?: string; author?: string }]> } | null = null;

async function getMappings() {
  if (mappings && Date.now() - mappings.at < 3_600_000) return mappings.data;
  const res = await manager("/customnode/getmappings?mode=cache");
  if (!res.ok) throw new Error(say("ComfyUI Manager could not list node packs ({status}).", { status: res.status }));
  mappings = { at: Date.now(), data: await res.json() };
  return mappings.data;
}

export async function managerVersion(): Promise<string | null> {
  try {
    const res = await manager("/manager/version");
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

async function installedPacks(): Promise<Set<string>> {
  try {
    const res = await manager("/customnode/installed");
    if (!res.ok) return new Set();
    const j = (await res.json()) as Record<string, { cnr_id?: string; aux_id?: string }>;
    const ids = new Set<string>();
    for (const [name, p] of Object.entries(j)) {
      ids.add(name.toLowerCase());
      if (p.cnr_id) ids.add(p.cnr_id.toLowerCase());
      if (p.aux_id) ids.add(p.aux_id.toLowerCase());
    }
    return ids;
  } catch {
    return new Set();
  }
}

const registryCache = new Map<string, { name?: string; description?: string; repository?: string; github_stars?: number; publisher?: { name?: string } } | null>();

async function registryInfo(id: string) {
  if (registryCache.has(id)) return registryCache.get(id)!;
  try {
    const res = await fetch(`https://api.comfy.org/nodes/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10_000) });
    const info = res.ok ? await res.json() : null;
    registryCache.set(id, info);
    return info;
  } catch {
    return null;
  }
}

const isUrl = (k: string) => /^https?:\/\//.test(k);
const ghId = (url: string) => {
  const m = /github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
};

/**
 * Pick the fewest packs that cover the missing nodes: greedy set cover, preferring registry
 * packs, then popularity. Forks that duplicate a popular pack lose to the original.
 */
export async function planPacks(missing: string[]): Promise<PackPlan> {
  const version = await managerVersion();
  if (!version || !missing.length) return { manager: { available: !!version, version }, packs: [], unknown: missing };

  const data = await getMappings();
  const candidates = new Map<string, { key: string; nodes: Set<string>; title: string }>();
  for (const [key, [nodes, meta]] of Object.entries(data)) {
    const hit = missing.filter((n) => nodes.includes(n));
    if (hit.length) candidates.set(key, { key, nodes: new Set(hit), title: meta.title_aux ?? key });
  }

  const remaining = new Set(missing);
  const chosen: { key: string; covers: string[]; title: string }[] = [];
  while (remaining.size) {
    let best: { key: string; covers: string[]; title: string } | null = null;
    let bestScore = 0;
    for (const c of candidates.values()) {
      const covers = [...c.nodes].filter((n) => remaining.has(n));
      if (!covers.length) continue;
      // Coverage first; registry beats a bare GitHub URL on ties.
      const score = covers.length * 10 + (isUrl(c.key) ? 0 : 5);
      if (score > bestScore) {
        best = { key: c.key, covers, title: c.title };
        bestScore = score;
      }
    }
    if (!best) break;
    chosen.push(best);
    best.covers.forEach((n) => remaining.delete(n));
    candidates.delete(best.key);
  }

  const installed = await installedPacks();
  const packs = await Promise.all(
    chosen.map(async (c): Promise<PackSuggestion> => {
      const registry = !isUrl(c.key);
      const info = registry ? await registryInfo(c.key) : null;
      const repository = info?.repository ?? (isUrl(c.key) ? c.key : null);
      const id = registry ? c.key : (ghId(c.key) ?? c.key);
      return {
        id,
        title: info?.name ?? c.title,
        author: (info?.publisher?.name && info.publisher.name !== "Unclaimed" ? info.publisher.name : null) ?? (repository ? (ghId(repository)?.split("/")[0] ?? null) : null),
        description: info?.description?.split("\n")[0]?.slice(0, 160) ?? null,
        repository,
        stars: info?.github_stars ?? null,
        registry,
        covers: c.covers,
        installed: installed.has(id.toLowerCase()) || (!!repository && installed.has((ghId(repository) ?? "").toLowerCase())),
        displayOnly: c.covers.every(isDisplayOnly),
      };
    }),
  );
  packs.sort((a, b) => Number(a.displayOnly) - Number(b.displayOnly) || b.covers.length - a.covers.length || (b.stars ?? 0) - (a.stars ?? 0));
  return { manager: { available: true, version }, packs, unknown: [...remaining] };
}

const CLIENT = "novafield";

/** Queue Manager installs. Returns the task id for each pack. */
export async function queueInstalls(packs: Pick<PackSuggestion, "id" | "registry" | "repository">[]): Promise<Record<string, string>> {
  const tasks: Record<string, string> = {};
  for (const p of packs) {
    const ui_id = `nf-${randomUUID().slice(0, 8)}`;
    const params = p.registry
      ? { id: p.id, version: "latest", selected_version: "latest", mode: "cache", channel: "default" }
      : { id: p.id, version: "nightly", selected_version: "nightly", repository: p.repository, mode: "cache", channel: "default" };
    const res = await manager("/manager/queue/task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ui_id, client_id: CLIENT, kind: "install", params }),
    });
    if (!res.ok) throw new Error(say("ComfyUI Manager refused to queue {pack}: {reason}", { pack: p.id, reason: (await res.text()).slice(0, 200) }));
    tasks[p.id] = ui_id;
  }
  // Manager v4 only starts its queue on POST (a GET is a 404 and the tasks just sit there).
  await manager("/manager/queue/start", { method: "POST" });
  return tasks;
}

export type TaskState = { state: "waiting" | "done" | "failed"; message?: string };

/** Where each queued install stands, by task id. */
export async function installStatus(tasks: Record<string, string>): Promise<Record<string, TaskState>> {
  const out: Record<string, TaskState> = {};
  for (const [id, ui_id] of Object.entries(tasks)) {
    try {
      const res = await manager(`/manager/queue/history?ui_id=${encodeURIComponent(ui_id)}`);
      const j = res.ok ? ((await res.json()) as { history?: Record<string, { result?: string; status?: { status_str?: string; completed?: boolean; messages?: string[] } }> | { result?: string; status?: { status_str?: string } } }) : null;
      const h = j?.history as Record<string, unknown> | undefined;
      const item = (h && (ui_id in h ? h[ui_id] : "result" in h ? h : undefined)) as { result?: string; status?: { status_str?: string; messages?: string[] } } | undefined;
      if (!item) {
        out[id] = { state: "waiting" };
        continue;
      }
      const ok = ["success", "skip", "skipped"].includes(item.status?.status_str ?? "") || item.result === "success";
      out[id] = ok ? { state: "done" } : { state: "failed", message: friendlyFailure(item.result ?? item.status?.messages?.join(" ") ?? "") };
    } catch {
      out[id] = { state: "waiting" };
    }
  }
  return out;
}

function friendlyFailure(raw: string): string {
  // Manager v4 reports a bare "failed" when it refuses an install from a GitHub link it doesn't list.
  if (/^\s*failed\s*$/i.test(raw) || /git[_ ]?url/i.test(raw))
    return say("ComfyUI Manager didn't install it. Packs outside Manager's catalogue need allow_git_url_install = true in Manager's config.ini (restart ComfyUI after), or install by hand:");
  if (/security|not allowed|middle/i.test(raw))
    return say("ComfyUI Manager's security level blocks this install. In ComfyUI open Manager → settings, set the security level to normal, then try again.");
  return raw.split("\n").find((l) => l.trim())?.slice(0, 240) || say("The install failed. ComfyUI's console has the details.");
}

/** Ask Manager to restart ComfyUI so new packs load. */
export async function restartComfy() {
  if (isCloud()) throw new Error(say("Comfy Cloud can't install node packs. Connect a local ComfyUI to add them."));
  const res = await manager("/manager/reboot").catch(() => null);
  // The server drops the connection as it restarts; only an explicit refusal is an error.
  if (res && res.status === 403) throw new Error(say("ComfyUI Manager's security settings don't allow restarting from outside. Restart ComfyUI on the PC."));
}

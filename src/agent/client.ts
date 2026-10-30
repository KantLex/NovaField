// A typed client for NovaField's local HTTP API, shared by the MCP server and the CLI.
// Everything goes through the running app (http://localhost:4317 by default), never ComfyUI directly.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AssetEntry, AssetKind, Purpose } from "@/lib/assets";
import { checkBudget, type Budget } from "@/lib/comfy/budget";
import type { GraphPrice } from "@/lib/comfy/credits";
import type { Asset, JobSpec } from "@/lib/engines/specs";
import { isLive, type Job, type JobStatus } from "@/lib/jobs";
import type { Project } from "@/lib/projects";
import type { QcReport } from "@/lib/qc";
import { UNSORTED } from "@/lib/projects";
import type { Clip } from "@/lib/sequence";
import type { RecipeSummary } from "@/lib/workflows/types";
import type { TemplateLibrary } from "@/server/templates";

export const DEFAULT_URL = "http://localhost:4317";

export interface Status {
  url: string;
  mode: "local" | "cloud";
  online: boolean;
  dryRun: boolean;
  apiKey: boolean;
  version: string | null;
  gpu: { name: string; vramFree: number; vramTotal: number } | null;
  queue: { running: number; pending: number } | null;
  nodeCount: number;
  caps: Record<string, unknown>;
}

export interface Preflight {
  meta: Job["meta"] | null;
  nodes: number;
  issues: { classType: string; input?: string; message: string }[];
  warnings: { classType: string; input?: string; message: string }[];
  paid: string[];
  price: GraphPrice | null;
  blocker: string | null;
}

export interface TakeFilter {
  /** A project id, "unsorted" for takes in none; left out means every take. */
  project?: string;
  status?: JobStatus | "live";
  kind?: Job["kind"];
  favorite?: boolean;
  /** Words to find in the title. */
  query?: string;
  limit?: number;
}

/** Raised by the app (its own error text) or by the credit guard. */
export class NovaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "NovaError";
  }
}

export class BudgetError extends NovaError {
  constructor(readonly budget: Budget) {
    super(budget.reason ?? "Over budget.", 402, budget);
    this.name = "BudgetError";
  }
}

type Fetch = typeof fetch;

export class NovaField {
  readonly base: string;
  private readonly fetcher: Fetch;

  constructor(opts: { url?: string; fetch?: Fetch } = {}) {
    this.base = (opts.url ?? process.env.NOVAFIELD_URL ?? DEFAULT_URL).replace(/\/+$/, "");
    this.fetcher = opts.fetch ?? fetch;
  }

  /** An app path ("/api/files/media/x.mp4") as a full URL. */
  absolute(url: string | undefined): string | undefined {
    return url ? (url.startsWith("/") ? `${this.base}${url}` : url) : undefined;
  }

  private async call<T>(route: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const { json, ...rest } = init;
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}${route}`, {
        ...rest,
        ...(json !== undefined ? { body: JSON.stringify(json), headers: { "content-type": "application/json", ...rest.headers } } : {}),
      });
    } catch (e) {
      throw new NovaError(`NovaField isn't answering at ${this.base} (${e instanceof Error ? e.message : String(e)}). Start it with \`pnpm dev\`.`);
    }
    const body = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) throw new NovaError((body as { error?: string }).error ?? `${route} failed (${res.status}).`, res.status, body);
    return body as T;
  }

  // Server and connection

  status = () => this.call<Status>("/api/status");

  // Takes

  async takes(f: TakeFilter = {}): Promise<Job[]> {
    const q = f.query?.toLowerCase();
    const all = await this.call<Job[]>("/api/jobs");
    const hits = all.filter(
      (j) =>
        (f.project === undefined || (f.project === UNSORTED ? !j.project : j.project === f.project)) &&
        (f.status === undefined || (f.status === "live" ? isLive(j) : j.status === f.status)) &&
        (f.kind === undefined || j.kind === f.kind) &&
        (f.favorite === undefined || !!j.favorite === f.favorite) &&
        (!q || j.title.toLowerCase().includes(q)),
    );
    return hits.slice(0, f.limit ?? 50);
  }

  take = (id: string) => this.call<Job>(`/api/jobs/${encodeURIComponent(id)}`);

  /** Poll a take until it finishes, fails or is cancelled, or until the time is up (then it's still live). */
  async wait(id: string, { timeoutMs = 120_000, intervalMs = 2_000, sleep = defaultSleep } = {}): Promise<Job> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.take(id);
      if (!isLive(job) || Date.now() >= until) return job;
      await sleep(Math.min(intervalMs, Math.max(0, until - Date.now())));
    }
  }

  preflight = (spec: JobSpec) => this.call<Preflight>("/api/preflight", { method: "POST", json: { spec } });

  /** Price every spec and hold the total under `maxCredits`; nothing is queued when it might go over. */
  async budget(specs: JobSpec[], maxCredits: number): Promise<{ budget: Budget; checks: Preflight[] }> {
    const checks = await Promise.all(specs.map((s) => this.preflight(s)));
    const issues = checks.flatMap((c) => c.issues);
    const budget = checkBudget(checks, maxCredits);
    if (budget.ok && issues.length) return { budget: { ...budget, ok: false, reason: `The graph has problems: ${issues.map((i) => `${i.classType}${i.input ? `.${i.input}` : ""}: ${i.message}`).join("; ")}` }, checks };
    return { budget, checks };
  }

  /**
   * Queue renders (1–8). `maxCredits` is required: the guard refuses when the preflight price could
   * exceed it, and the app checks it again before queueing. Use 0 for local GPU work only.
   */
  async generate(specs: JobSpec[], opts: { maxCredits: number; project?: string | null }): Promise<{ jobs: Job[]; budget: Budget }> {
    if (typeof opts.maxCredits !== "number" || Number.isNaN(opts.maxCredits)) throw new NovaError("max_credits is required: the most credits these renders may spend (0 for local GPU only).");
    if (!specs.length || specs.length > 8) throw new NovaError("Send between 1 and 8 renders at a time.");
    const { budget } = await this.budget(specs, opts.maxCredits);
    if (!budget.ok) throw new BudgetError(budget);
    const jobs = await this.call<Job[]>("/api/jobs", { method: "POST", json: { specs, project: opts.project ?? null, maxCredits: opts.maxCredits } });
    return { jobs, budget };
  }

  /** Cancel one of NovaField's own takes (only its own prompt; other work on the server is left alone). */
  cancel = (id: string) => this.call<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });

  star = (id: string, favorite: boolean) => this.call<Job>(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", json: { favorite } });

  move = (ids: string[], project: string | null) => this.call<{ moved: number }>("/api/jobs/move", { method: "POST", json: { ids, project } });

  // Projects

  projects = () => this.call<Project[]>("/api/projects");

  createProject = (name: string) => this.call<Project>("/api/projects", { method: "POST", json: { name } });

  /** A project by id or (case-insensitive) name. */
  async findProject(idOrName: string): Promise<Project | undefined> {
    const list = await this.projects();
    const n = idOrName.trim().toLowerCase();
    return list.find((p) => p.id === idOrName) ?? list.find((p) => p.name.toLowerCase() === n);
  }

  // Assets

  assets = () => this.call<AssetEntry[]>("/api/assets");

  createAsset = (a: { name: string; kind: AssetKind; description?: string }) => this.call<AssetEntry>("/api/assets", { method: "POST", json: a });

  /** Throws, before anything is created, if a file isn't there or a URL isn't one of the app's own. */
  checkAssetFiles(files: string[]) {
    for (const f of files) {
      if (f.startsWith("/api/files/") || f.startsWith(`${this.base}/api/files/`)) continue;
      if (/^https?:\/\//i.test(f)) throw new NovaError(`${f} isn't a NovaField file. Download it first, then add the local file.`);
      if (!existsSync(f)) throw new NovaError(`No file at ${f}.`);
    }
  }

  /** Add pictures, clips or audio: local file paths are uploaded; app URLs (a take's video or still) are copied. */
  async addAssetFiles(id: string, files: string[]): Promise<AssetEntry> {
    this.checkAssetFiles(files);
    const urls = files.filter((f) => f.startsWith("/api/files/") || f.startsWith(`${this.base}/api/files/`)).map((f) => f.replace(this.base, ""));
    const paths = files.filter((f) => !urls.includes(f) && !f.startsWith(`${this.base}/`));
    let entry: AssetEntry | null = null;
    if (paths.length) {
      const form = new FormData();
      for (const p of paths) form.append("file", new Blob([new Uint8Array(await readFile(p))]), path.basename(p));
      entry = await this.call<AssetEntry>(`/api/assets/${encodeURIComponent(id)}/items`, { method: "POST", body: form });
    }
    if (urls.length) entry = await this.call<AssetEntry>(`/api/assets/${encodeURIComponent(id)}/items`, { method: "POST", json: { urls } });
    if (!entry) throw new NovaError("Give at least one file path or take URL.");
    return entry;
  }

  /** An asset's files (all, or some) conformed for a purpose and placed in ComfyUI's input folder. */
  useAsset = (id: string, purpose: Purpose, items?: string[]) => this.call<Asset[]>("/api/assets/use", { method: "POST", json: { id, purpose, items } });

  /** A frame of a finished video take as a ComfyUI-ready picture: the last frame, or `at` seconds in. */
  frame = (id: string, at?: number) => this.call<Asset>(`/api/jobs/${encodeURIComponent(id)}/frame`, { method: "POST", json: at === undefined ? {} : { at } });

  /** Shot QC on a finished clip (on the GPU): its score and faults, also kept on the take. */
  qc = (id: string) => this.call<QcReport>(`/api/jobs/${encodeURIComponent(id)}/qc`, { method: "POST" });

  /** Import a ComfyUI workflow: its JSON (canvas or API format), a template from ComfyUI's library, or one saved in ComfyUI. */
  importWorkflow = (json: unknown, source: string) => this.call<RecipeSummary>("/api/workflows", { method: "POST", json: { json, source } });
  importTemplate = (name: string, pack?: string, title?: string) => this.call<RecipeSummary>("/api/workflows/templates", { method: "POST", json: { name, pack, title } });
  importSaved = (path: string) => this.call<RecipeSummary>("/api/workflows/server", { method: "POST", json: { path } });
  templates = () => this.call<TemplateLibrary>("/api/workflows/templates");
  savedWorkflows = () => this.call<{ path: string }[]>("/api/workflows/server");

  /** A finished take's file conformed for a purpose, like an upload (a previs clip, a frame). */
  useTake = (id: string, purpose: Purpose) => this.call<Asset>(`/api/jobs/${encodeURIComponent(id)}/use`, { method: "POST", json: { purpose } });

  /** Upload a local file for a purpose (image, h3, wan, raw) and get the ComfyUI-ready asset. */
  async upload(file: string, purpose: Purpose): Promise<Asset> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(await readFile(file))]), path.basename(file));
    form.append("purpose", purpose);
    return this.call<Asset>("/api/upload", { method: "POST", body: form });
  }

  // Workflows

  workflows = () => this.call<RecipeSummary[]>("/api/workflows");

  workflow = (id: string) => this.call<RecipeSummary & { nodes: number }>(`/api/workflows/${encodeURIComponent(id)}`);

  // The edit and films

  /** The edit of a project ("all" when no project is chosen in the editor). */
  sequence = (key: string) => this.call<{ key: string; clips: Clip[] }>(`/api/sequences/${encodeURIComponent(key)}`);

  /** Replace an edit. Plain take ids become whole clips; clips without an out point run to the end of their take. */
  setSequence = (key: string, clips: (Partial<Clip> & { take: string })[] | string[]) =>
    this.call<{ key: string; clips: Clip[] }>(`/api/sequences/${encodeURIComponent(key)}`, { method: "PUT", json: { clips, origin: "agent" } });

  /** Cut finished takes into one film with ffmpeg on this machine (no GPU, no credits). */
  assemble = (clips: Clip[], title?: string, soundtrack?: { url: string; start?: number; mix?: "replace" | "under"; volume?: number }) =>
    this.call<{ id: string; url: string; title: string }>("/api/films", { method: "POST", json: { clips, title, soundtrack } });
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

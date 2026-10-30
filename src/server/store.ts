// Job history in data/jobs.json, plus an in-process event bus for the live UI.

import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Compiled } from "@/lib/engines";
import type { Job } from "@/lib/jobs";
import { DATA_DIR } from "./config";
import { writeJson } from "./jsonFile";

const FILE = path.join(DATA_DIR, "jobs.json");

class Store {
  private jobs = new Map<string, Job>();
  private graphs = new Map<string, Compiled["graph"]>();
  private loaded: Promise<void> | null = null;
  private saving: Promise<void> = Promise.resolve();
  private queued = false;
  readonly events = new EventEmitter();

  constructor() {
    this.events.setMaxListeners(100);
  }

  private load() {
    this.loaded ??= (async () => {
      try {
        const raw = JSON.parse(await readFile(FILE, "utf8")) as Job[];
        for (const j of raw) {
          // A restart loses the WebSocket subscription; the runner re-attaches to live prompts.
          this.jobs.set(j.id, j);
        }
      } catch {
        /* first run */
      }
    })();
    return this.loaded;
  }

  async all(): Promise<Job[]> {
    await this.load();
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string) {
    await this.load();
    return this.jobs.get(id) ?? null;
  }

  graph(id: string) {
    return this.graphs.get(id) ?? null;
  }

  setGraph(id: string, g: Compiled["graph"]) {
    this.graphs.set(id, g);
  }

  async put(job: Job) {
    await this.load();
    job.updatedAt = Date.now();
    this.jobs.set(job.id, job);
    this.events.emit("job", job);
    this.persist();
  }

  async patch(id: string, p: Partial<Job>) {
    const job = await this.get(id);
    if (!job) return null;
    Object.assign(job, p);
    await this.put(job);
    return job;
  }

  async remove(id: string) {
    await this.load();
    this.jobs.delete(id);
    this.events.emit("removed", id);
    this.persist();
  }

  private persist() {
    // Many changes in a row (a render's progress) make one write, at most every 300 ms; writes stay
    // in order, and write-then-rename means a crash never leaves half a file.
    if (this.queued) return;
    this.queued = true;
    this.saving = this.saving
      .then(() => new Promise((r) => setTimeout(r, 300)))
      .then(async () => {
        this.queued = false;
        await writeJson(FILE, [...this.jobs.values()]);
      })
      .catch((e) => console.error("Saving jobs.json failed:", e));
  }
}

const g = globalThis as unknown as { __novaStore?: Store };
export const STORE: Store = (g.__novaStore ??= new Store());

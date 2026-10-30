// ComfyUI's status for the header (online, GPU, queue, engines), kept here and pushed to every tab
// over the live feed (/api/events) instead of each tab asking every few seconds. It's read again
// the moment the hub's socket to ComfyUI opens or drops, when ComfyUI says its queue changed, and
// every 30 s for the GPU's free memory, but only while some tab is watching.

import { queueState, systemStats } from "./comfy";
import { DRY_RUN } from "./config";
import { isCloud, partnerKey, publicConnection } from "./connection";
import { HUB } from "./hub";
import { capabilities } from "./runner";

export async function readStatus() {
  HUB.ensure();
  const [stats, queue, { caps, info }] = await Promise.all([systemStats().catch(() => null), queueState().catch(() => null), capabilities()]);
  const gpu = stats?.devices?.[0];
  const conn = publicConnection();
  const cloud = isCloud();
  return {
    url: cloud ? "cloud.comfy.org" : conn.url,
    mode: conn.mode,
    // Cloud's stats are public, so only a node list proves the key works.
    online: cloud ? !!info : !!stats,
    dryRun: DRY_RUN,
    apiKey: !!partnerKey(),
    version: stats?.system.comfyui_version ?? null,
    gpu: gpu ? { name: gpu.name.replace(/^cuda:\d+\s*/, "").replace(/\s*:\s*\w+$/, ""), vramFree: gpu.vram_free, vramTotal: gpu.vram_total } : null,
    queue: queue ? { running: queue.queue_running.length, pending: queue.queue_pending.length } : null,
    nodeCount: info ? Object.keys(info).length : 0,
    caps,
  };
}

export type Status = Awaited<ReturnType<typeof readStatus>>;
type Listener = (s: Status) => void;

const EVERY_MS = 30_000;

class StatusFeed {
  private latest: Status | null = null;
  private listeners = new Set<Listener>();
  private reading: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unhook: (() => void) | null = null;

  /** Follow the status: `l` hears it now (once known) and whenever it changes. */
  watch(l: Listener): () => void {
    this.listeners.add(l);
    if (this.latest) l(this.latest);
    if (this.listeners.size === 1) this.start();
    else if (!this.latest) void this.refresh();
    return () => {
      this.listeners.delete(l);
      if (!this.listeners.size) this.stop();
    };
  }

  /** The status right now, read fresh (and passed on to the tabs if it changed). */
  async read(): Promise<Status> {
    await this.refresh();
    return this.latest ?? readStatus();
  }

  /** Read the status again; calls that arrive while a read is under way share one follow-up read. */
  refresh(): Promise<void> {
    if (this.reading) {
      this.again = true;
      return this.reading;
    }
    this.reading = (async () => {
      do {
        this.again = false;
        const next = await readStatus().catch(() => null);
        if (next && JSON.stringify(next) !== JSON.stringify(this.latest)) {
          this.latest = next;
          for (const l of this.listeners) l(next);
        }
      } while (this.again);
    })().finally(() => (this.reading = null));
    return this.reading;
  }

  private start() {
    const offEvents = HUB.onAny((e) => e.type === "status" && void this.refresh());
    const offLink = HUB.onLink(() => void this.refresh());
    this.unhook = () => {
      offEvents();
      offLink();
    };
    this.timer = setInterval(() => void this.refresh(), EVERY_MS);
    void this.refresh();
  }

  private stop() {
    this.unhook?.();
    this.unhook = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const g = globalThis as unknown as { __novaStatus?: StatusFeed };
export const STATUS: StatusFeed = (g.__novaStatus ??= new StatusFeed());

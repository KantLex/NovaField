// One long-lived WebSocket to ComfyUI per app process. ComfyUI sends progress events only to
// the client_id that queued a prompt, so every NovaField prompt is queued with HUB.clientId.

import { randomUUID } from "node:crypto";
import { forgetObjectInfo } from "./comfy";
import { wsUrl } from "./connection";

export type ComfyEvent =
  | { type: "status"; data: { status: { exec_info: { queue_remaining: number } } } }
  | { type: "execution_start"; data: { prompt_id: string } }
  | { type: "execution_cached"; data: { prompt_id: string; nodes: string[] } }
  | { type: "executing"; data: { prompt_id: string; node: string | null } }
  | { type: "progress"; data: { prompt_id: string; node: string; value: number; max: number } }
  | { type: "executed"; data: { prompt_id: string; node: string; output: unknown } }
  | { type: "execution_success"; data: { prompt_id: string } }
  | { type: "execution_error"; data: { prompt_id: string; node_type: string; exception_message: string } }
  | { type: "execution_interrupted"; data: { prompt_id: string } };

type Listener = (e: ComfyEvent) => void;

class Hub {
  readonly clientId = `novafield-${randomUUID()}`;
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private global = new Set<Listener>();
  private link = new Set<(connected: boolean) => void>();
  private retry = 1000;
  connected = false;
  private wasConnected = false;
  private closed = false;
  queueRemaining = 0;

  ensure() {
    if (this.ws || this.closed) return;
    const ws = new WebSocket(wsUrl(this.clientId));
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      // Back after a drop: ComfyUI may have restarted with other node packs.
      if (this.wasConnected) forgetObjectInfo();
      this.wasConnected = true;
      this.setConnected(true);
      this.retry = 1000;
    };
    ws.onmessage = (msg) => {
      if (this.ws !== ws || typeof msg.data !== "string") return; // a replaced socket, or binary preview frames
      let e: ComfyEvent;
      try {
        e = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (e.type === "status") this.queueRemaining = e.data.status.exec_info.queue_remaining;
      for (const l of this.global) l(e);
      const pid = (e.data as { prompt_id?: string }).prompt_id;
      if (pid) for (const l of this.listeners.get(pid) ?? []) l(e);
    };
    const reconnect = () => {
      if (this.ws !== ws) return;
      this.setConnected(false);
      this.ws = null;
      setTimeout(() => this.ensure(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    };
    ws.onclose = reconnect;
    ws.onerror = () => ws.close();
  }

  /** Drop the socket and dial the server the connection now points at. */
  reset() {
    const old = this.ws;
    this.ws = null;
    this.closed = false;
    this.setConnected(false);
    this.retry = 1000;
    old?.close();
    this.ensure();
  }

  /** Hang up for good (tests, shutdown), retries included, until reset(). */
  close() {
    const old = this.ws;
    this.ws = null;
    this.closed = true;
    this.setConnected(false);
    old?.close();
  }

  private setConnected(connected: boolean) {
    if (connected === this.connected) return;
    this.connected = connected;
    for (const l of this.link) l(connected);
  }

  /** Hear when the socket to ComfyUI opens or drops (ComfyUI started, stopped, or the connection moved). */
  onLink(l: (connected: boolean) => void) {
    this.link.add(l);
    return () => this.link.delete(l);
  }

  on(promptId: string, l: Listener) {
    this.ensure();
    const set = this.listeners.get(promptId) ?? new Set();
    set.add(l);
    this.listeners.set(promptId, set);
    return () => {
      set.delete(l);
      if (!set.size) this.listeners.delete(promptId);
    };
  }

  onAny(l: Listener) {
    this.ensure();
    this.global.add(l);
    return () => this.global.delete(l);
  }
}

const g = globalThis as unknown as { __novaHub?: Hub };
export const HUB: Hub = (g.__novaHub ??= new Hub());

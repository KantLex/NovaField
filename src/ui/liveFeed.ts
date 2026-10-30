"use client";

// The live feed (/api/events): every job change, edit, project and asset, and ComfyUI's status,
// as it happens.
//
// Browsers allow about six connections per site, and each feed holds one open for good, so a few
// tabs used to starve the rest ("Connecting…" forever). Now one tab holds the feed and relays it to
// the others over a BroadcastChannel; when that tab closes, another takes over (Web Locks). A tab
// that joins loads the current state itself, then follows the relay.
//
// The feed also has a watchdog: the server pings every 15 s, so a connection that hasn't opened in
// 12 s, or has gone quiet for 45 s, is dropped and opened again.

import { useEffect } from "react";
import type { AssetEntry } from "@/lib/assets";
import type { Job } from "@/lib/jobs";
import type { Project } from "@/lib/projects";
import type { Clip } from "@/lib/sequence";
import { request } from "./api";
import { useAssets } from "./assets/store";
import { useProjects } from "./projects";
import { receiveEdit, receiveEdits } from "./sequence";
import { useLive, type ServerStatus } from "./state";

const EVENTS = ["snapshot", "job", "removed", "projects", "assets", "sequences", "sequence", "status"] as const;
type FeedEvent = (typeof EVENTS)[number];
type Message = { event: FeedEvent; data: unknown } | { state: "open" | "down" };

const OPEN_TIMEOUT = 12_000;
const QUIET_TIMEOUT = 45_000;
const RETRY = 2500;

function apply(event: FeedEvent, data: unknown) {
  const live = useLive.getState();
  switch (event) {
    case "snapshot":
      return live.setSnapshot(data as Job[]);
    case "job":
      return live.upsert(data as Job);
    case "removed":
      return live.remove((data as { id: string }).id);
    case "projects":
      return useProjects.getState().setList(data as Project[]);
    case "assets":
      return useAssets.getState().setList(data as AssetEntry[]);
    case "sequences":
      return receiveEdits(data as Record<string, Clip[]>);
    case "sequence":
      return receiveEdit(data as Parameters<typeof receiveEdit>[0]);
    case "status":
      return live.setStatus(data as ServerStatus);
  }
}

/** Hold the feed for this tab (and relay it to `relay`) until `stop` is called. */
function holdFeed(relay: ((m: Message) => void) | null): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const { setConnected } = useLive.getState();

  const arm = (ms: number) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => restart(), ms);
  };
  const restart = () => {
    es?.close();
    es = null;
    clearTimeout(watchdog);
    setConnected(false);
    relay?.({ state: "down" });
    if (!stopped) retry = setTimeout(open, RETRY);
  };
  const open = () => {
    if (stopped) return;
    es = new EventSource("/api/events");
    arm(OPEN_TIMEOUT);
    for (const event of EVENTS)
      es.addEventListener(event, (e) => {
        arm(QUIET_TIMEOUT);
        const data = JSON.parse((e as MessageEvent).data);
        apply(event, data);
        relay?.({ event, data });
      });
    // Pings are comments, which EventSource doesn't surface; any message or the open keeps it alive.
    es.onmessage = () => arm(QUIET_TIMEOUT);
    es.onopen = () => {
      arm(QUIET_TIMEOUT);
      setConnected(true);
      relay?.({ state: "open" });
    };
    es.onerror = restart;
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(watchdog);
    es?.close();
  };
}

/** What a tab that follows the relay loads for itself first. */
async function catchUp() {
  const [jobs, edits, status] = await Promise.all([request<Job[]>("/api/jobs"), request<Record<string, Clip[]>>("/api/sequences"), request<ServerStatus>("/api/status")]);
  apply("snapshot", jobs);
  apply("sequences", edits);
  apply("status", status);
  useLive.getState().setConnected(true);
}

export function useLiveFeed() {
  useEffect(() => {
    void useProjects.getState().refresh().catch(() => {});
    // Without Web Locks or BroadcastChannel (old browsers), every tab holds its own feed.
    if (typeof BroadcastChannel === "undefined" || !navigator.locks) return holdFeed(null);

    const channel = new BroadcastChannel("novafield-live");
    let leading = false;
    let stopFeed: (() => void) | null = null;
    let release: () => void = () => {};
    const quit = new AbortController();

    channel.onmessage = (m: MessageEvent<Message>) => {
      if (leading) return;
      const msg = m.data;
      if ("state" in msg) useLive.getState().setConnected(msg.state === "open");
      else apply(msg.event, msg.data);
    };
    void catchUp().catch(() => {});

    // The first tab to get the lock leads; the rest wait in line and take over if it closes.
    navigator.locks
      .request("novafield-live-feed", { signal: quit.signal }, () => {
        leading = true;
        stopFeed = holdFeed((msg) => channel.postMessage(msg));
        return new Promise<void>((resolve) => (release = resolve));
      })
      .catch(() => {}); // aborted while waiting: the tab closed first

    return () => {
      quit.abort();
      stopFeed?.();
      release();
      channel.close();
    };
  }, []);
}

import { connection } from "next/server";
import type { Job } from "@/lib/jobs";
import { resumeLive } from "@/server/runner";
import { allSequences } from "@/server/sequences";
import { STATUS } from "@/server/status";
import { STORE } from "@/server/store";

// Server-sent events: every job change, edit, project and asset, and ComfyUI's status, so every
// screen stays live without asking.
export async function GET(request: Request) {
  await connection();
  await resumeLive();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("snapshot", await STORE.all());
      send("sequences", await allSequences());
      const onJob = (job: Job) => send("job", job);
      const onRemoved = (id: string) => send("removed", { id });
      const onProjects = (list: unknown) => send("projects", list);
      const onAssets = (list: unknown) => send("assets", list);
      const onSequence = (change: unknown) => send("sequence", change);
      STORE.events.on("job", onJob);
      STORE.events.on("removed", onRemoved);
      STORE.events.on("projects", onProjects);
      STORE.events.on("assets", onAssets);
      STORE.events.on("sequence", onSequence);
      const unwatch = STATUS.watch((s) => send("status", s));
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 15_000);
      cleanup = () => {
        clearInterval(ping);
        unwatch();
        STORE.events.off("job", onJob);
        STORE.events.off("removed", onRemoved);
        STORE.events.off("projects", onProjects);
        STORE.events.off("assets", onAssets);
        STORE.events.off("sequence", onSequence);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

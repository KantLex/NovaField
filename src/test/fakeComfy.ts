// A stand-in ComfyUI for tests: the HTTP routes and WebSocket events NovaField uses, with a tiny
// node catalogue. A queued prompt "renders" at once: it reports progress over the socket, then
// lists one saved picture in its history.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { ApiGraph } from "@/lib/comfy/graph";
import type { ObjectInfo } from "@/lib/comfy/validate";

export const FAKE_INFO: ObjectInfo = {
  FakeTextToImage: {
    input: { required: { text: ["STRING", { multiline: true }], width: ["INT", { default: 512 }], height: ["INT", { default: 512 }] } },
    output: ["IMAGE"],
    category: "image",
  },
  SaveImage: { input: { required: { images: ["IMAGE"], filename_prefix: ["STRING", { default: "ComfyUI" }] } }, output: [], output_node: true, category: "image" },
};

/** The smallest graph a Studio model can be: a prompt makes a picture, which is saved. */
export const TINY_WORKFLOW: ApiGraph = {
  "1": { class_type: "FakeTextToImage", inputs: { text: "a placeholder prompt", width: 512, height: 512 } },
  "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "nf" } },
};

// A 1×1 PNG.
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export interface FakeComfy {
  url: string;
  /** Prompts queued so far, in order. */
  prompts: { id: string; graph: ApiGraph; clientId: string }[];
  /** How many sockets are open now. */
  sockets: () => number;
  /** Send an event to every open socket. */
  broadcast: (e: unknown) => void;
  close: () => Promise<void>;
}

export async function startFakeComfy(port = 0): Promise<FakeComfy> {
  const prompts: FakeComfy["prompts"] = [];
  const history: Record<string, unknown> = {};
  const clients = new Map<string, WebSocket>();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const body = async () => {
      let s = "";
      for await (const chunk of req) s += chunk;
      return JSON.parse(s || "{}");
    };
    if (url.pathname === "/object_info") return json(FAKE_INFO);
    // Not ComfyUI's: lets a test in another process see what was queued.
    if (url.pathname === "/_prompts") return json(prompts);
    if (url.pathname === "/system_stats") return json({ system: { comfyui_version: "0.0.0-fake" }, devices: [{ name: "cuda:0 Fake GPU : cudaMallocAsync", vram_total: 24e9, vram_free: 20e9 }] });
    if (url.pathname === "/queue") return json({ queue_running: [], queue_pending: [] });
    if (url.pathname.startsWith("/history/")) {
      const id = url.pathname.slice("/history/".length);
      return json(history[id] ? { [id]: history[id] } : {});
    }
    if (url.pathname === "/view") {
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(PNG);
    }
    if (url.pathname === "/prompt" && req.method === "POST") {
      const { prompt, client_id } = await body();
      const id = `p${prompts.length + 1}`;
      prompts.push({ id, graph: prompt, clientId: client_id });
      json({ prompt_id: id, number: prompts.length });
      // Render "at once", after the reply has gone out.
      setTimeout(() => {
        const ws = clients.get(client_id);
        const send = (type: string, data: unknown) => ws?.send(JSON.stringify({ type, data }));
        send("execution_start", { prompt_id: id });
        for (const node of Object.keys(prompt)) send("executing", { prompt_id: id, node });
        history[id] = {
          status: { status_str: "success", completed: true, messages: [] },
          outputs: { "2": { images: [{ filename: "nf_00001_.png", subfolder: "", type: "output" }] } },
        };
        send("execution_success", { prompt_id: id });
      }, 20);
      return;
    }
    json({ error: "not found" }, 404);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const id = new URL(req.url ?? "/", "http://x").searchParams.get("clientId") ?? "";
    clients.set(id, ws);
    ws.send(JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: 0 } } } }));
    ws.on("close", () => clients.delete(id));
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const bound = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${bound}`,
    prompts,
    sockets: () => clients.size,
    broadcast: (e) => {
      for (const ws of clients.values()) ws.send(JSON.stringify(e));
    },
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

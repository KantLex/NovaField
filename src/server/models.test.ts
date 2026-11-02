// Which model files the ComfyUI PC has, and downloading the missing ones through the NovaField
// nodes; against a stand-in server with the pack's routes, or without them (older nodes).

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MODELS } from "@/lib/engines/capabilities";
import { HENSHIN_MODELS } from "@/lib/engines/henshinModels";
import { MODEL_FILES } from "@/lib/modelFiles";
import { MODEL_SETS } from "@/lib/modelSets";

let pack = true;
const asked: unknown[] = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const json = (body: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/object_info") return json({ UNETLoader: { input: { required: { unet_name: [[MODELS.wanVace], {}] } }, output: ["MODEL"] } });
  if (!pack) return json({ error: "not found" }, 404);
  if (url.pathname === "/novafield/models")
    return json({
      version: "0.5.0",
      files: {
        [MODELS.scail]: { installed: false, job: { state: "downloading", done: 5, total: 10 } },
        [MODELS.sam3]: { installed: true, job: { state: "done", done: 10, total: 10 } },
      },
    });
  if (url.pathname === "/novafield/models/download" && req.method === "POST") {
    let s = "";
    for await (const c of req) s += c;
    asked.push({ type: req.headers["content-type"], body: JSON.parse(s) });
    return json({ queued: JSON.parse(s).files });
  }
  json({ error: "not found" }, 404);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.chdir(await mkdtemp(path.join(os.tmpdir(), "nf-models-")));
process.env.COMFY_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const { downloadModels, filesOnServer, modelsStatus } = await import("./models");
const { forgetObjectInfo } = await import("./comfy");
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("model files", () => {
  it("knows where every file NovaField loads comes from", () => {
    const used = new Set([...Object.values(MODELS), ...Object.values(HENSHIN_MODELS).flatMap((l) => l.flatMap((m) => m.files)), ...MODEL_SETS.flatMap((s) => s.files)]);
    expect([...used].filter((f) => !(f in MODEL_FILES))).toEqual([]);
  });

  it("reads what's there from ComfyUI's own file lists", () => {
    expect([...filesOnServer({ X: { input: { required: { a: [["one.safetensors", "two.safetensors"], {}], b: ["INT", {}] }, optional: { c: [["three.pt"]] } }, output: [] } })]).toEqual([
      "one.safetensors",
      "two.safetensors",
      "three.pt",
    ]);
  });

  it("merges the server's lists with the downloads the nodes report", async () => {
    const s = await modelsStatus();
    expect(s.pack).toBe("0.5.0");
    expect(s.files[MODELS.wanVace].installed).toBe(true); // in the loader's list
    expect(s.files[MODELS.sam3].installed).toBe(true); // just downloaded
    expect(s.files[MODELS.scail]).toEqual({ installed: false, job: { state: "downloading", done: 5, total: 10 } });
    expect(s.files[MODELS.wanAti].installed).toBe(false);
  });

  it("asks the nodes for known files only, as JSON", async () => {
    expect(await downloadModels([MODELS.wanAti])).toEqual([MODELS.wanAti]);
    expect(asked.at(-1)).toEqual({ type: "application/json", body: { files: [MODELS.wanAti] } });
    await expect(downloadModels(["../evil.py"])).rejects.toThrow(/doesn't download/);
  });

  it("with older nodes, says so and still knows what's there", async () => {
    pack = false;
    forgetObjectInfo();
    const s = await modelsStatus();
    expect(s.pack).toBeNull();
    expect(s.files[MODELS.wanVace].installed).toBe(true);
    await expect(downloadModels([MODELS.wanAti])).rejects.toThrow(/Update the NovaField nodes/);
  });
});

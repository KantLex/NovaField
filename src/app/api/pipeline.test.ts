// End to end on the server: import a workflow, press Create in the Studio with it as the model,
// and the finished take lands in the library with its file on disk. ComfyUI is a stand-in
// (src/test/fakeComfy.ts) that speaks the same HTTP and WebSocket API. Each test file runs in its
// own process, so the working-directory switch never reaches the real data/ folder.

import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ShotSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { PNG, startFakeComfy, TINY_WORKFLOW } from "@/test/fakeComfy";

vi.mock("next/server", () => ({ connection: async () => {} }));

const comfy = await startFakeComfy();
const root = await mkdtemp(path.join(os.tmpdir(), "nf-pipeline-"));
process.chdir(root);
process.env.COMFY_URL = comfy.url;

const workflows = await import("./workflows/route");
const jobs = await import("./jobs/route");
const status = await import("./status/route");
const { HUB } = await import("@/server/hub");

afterAll(async () => {
  HUB.close();
  await comfy.close();
});

const post = (body: unknown) => new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** What the Studio sends when Create is pressed with an imported model picked. */
const shot = (engine: string): ShotSpec =>
  ({
    kind: "shot",
    prompt: "a lighthouse at dusk",
    cast: [],
    size: "medium",
    angle: "eye",
    lens: 35,
    move: "static",
    intensity: 1,
    rig: null,
    combo: null,
    engine,
    timing: "inOutSine",
    shake: 0,
    cameraMode: "prompt",
    rigStyle: "subject",
    lighting: "natural",
    film: { look: "kodak_2383", intensity: 0.75, grain: 0.35, halation: 0.3, vignette: 0.25, chromatic: 0.1, gateWeave: 0.15, streak: 0 },
    filmOnGpu: false,
    aspect: "16:9",
    quality: "draft",
    duration: 5,
    turbo: true,
    smooth: false,
    sound: false,
    seed: 7,
  }) as unknown as ShotSpec;

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("Studio to library", () => {
  it("renders a take through ComfyUI and brings it home", async () => {
    const imported = await workflows.POST(post({ json: TINY_WORKFLOW, source: "blank.json" }));
    expect(imported.status).toBe(200);
    const recipe = (await imported.json()) as { id: string; output: string };
    expect(recipe.output).toBe("image");

    const created = await jobs.POST(post({ specs: [shot(recipe.id)] }));
    expect(created.status).toBe(200);
    const [job] = (await created.json()) as Job[];

    const list = async () => (await (await jobs.GET()).json()) as Job[];
    const done = (await until(list, (l) => l.some((j) => j.id === job.id && (j.status === "done" || j.status === "failed")))).find((j) => j.id === job.id)!;
    expect(done.error).toBeUndefined();
    expect(done.status).toBe("done");
    expect(done.promptId).toBe("p1");

    // ComfyUI got the workflow with NovaField's client id, so progress came back to us.
    expect(comfy.prompts[0].clientId).toBe(HUB.clientId);
    expect(Object.values(comfy.prompts[0].graph).map((n) => n.class_type).sort()).toEqual(["FakeTextToImage", "SaveImage"]);
    // The Studio's prompt went into the workflow's prompt field.
    expect(String(comfy.prompts[0].graph["1"].inputs.text)).toContain("a lighthouse at dusk");

    // The picture is in the library's media folder, byte for byte.
    expect(done.image).toBe(`/api/files/media/${job.id}.png`);
    const file = path.join(root, "data", "media", `${job.id}.png`);
    expect(existsSync(file)).toBe(true);
    expect((await readFile(file)).equals(PNG)).toBe(true);
  });

  it("reports the server online with its GPU", async () => {
    const s = (await (await status.GET()).json()) as { online: boolean; gpu: { name: string } | null; version: string };
    expect(s.online).toBe(true);
    expect(s.gpu?.name).toBe("Fake GPU");
    expect(s.version).toBe("0.0.0-fake");
  });
});

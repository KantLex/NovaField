// The API routes, run as the server runs them, against a throwaway data folder. Each test file runs
// in its own process (Vitest forks), so switching the working directory here never reaches the
// real data/ folder.

import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/jobs";

// Outside Next there's no request scope for connection(); routes only call it to opt out of caching.
vi.mock("next/server", () => ({ connection: async () => {} }));

const root = await mkdtemp(path.join(os.tmpdir(), "nf-routes-"));
process.chdir(root);
const data = path.join(root, "data");
await mkdir(path.join(data, "media"), { recursive: true });

const job = (id: string, over: Partial<Job> = {}): Job =>
  ({
    id,
    kind: "shot",
    title: `Take ${id}`,
    spec: { kind: "shot" },
    status: "done",
    createdAt: 1,
    updatedAt: 1,
    progress: { stage: "Wrapped", pct: 1 },
    video: `/api/files/media/${id}.mp4`,
    poster: `/api/files/media/${id}.jpg`,
    meta: { seconds: 5, fps: 24 },
    ...over,
  }) as unknown as Job;
await writeFile(path.join(data, "jobs.json"), JSON.stringify([job("done1"), job("live1", { status: "running" }), job("nofile")]));
for (const f of ["done1.mp4", "done1.jpg", "done1_strip.jpg"]) await writeFile(path.join(data, "media", f), "x");
await mkdir(path.join(data, "uploads"), { recursive: true });
await writeFile(path.join(data, "uploads", "clip.mp4"), "clip");

// Loaded after the switch, so every module works out its folders from the throwaway one.
const jobs = await import("./jobs/[id]/route");
const use = await import("./jobs/[id]/use/route");
const sequences = await import("./sequences/[key]/route");
const storage = await import("./storage/route");

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;
const json = (method: string, body: unknown) => new Request("http://x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("takes", () => {
  it("renames a take, tidying spaces, and refuses a blank name or an unknown take", async () => {
    const ok = await jobs.PATCH(json("PATCH", { title: "  Night   street  " }), ctx({ id: "done1" }));
    expect(((await ok.json()) as Job).title).toBe("Night street");
    expect((await jobs.PATCH(json("PATCH", { title: "   " }), ctx({ id: "done1" }))).status).toBe(400);
    expect((await jobs.PATCH(json("PATCH", { favorite: true }), ctx({ id: "nope" }))).status).toBe(404);
  });

  it("won't delete a take still rendering, and deleting one removes its local files and leaves the edit", async () => {
    expect((await jobs.DELETE(new Request("http://x", { method: "DELETE" }), ctx({ id: "live1" }))).status).toBe(409);
    await sequences.PUT(json("PUT", { clips: [{ id: "c1", take: "done1", in: 0, out: 5 }] }), ctx({ key: "all" }));
    expect((await jobs.DELETE(new Request("http://x", { method: "DELETE" }), ctx({ id: "done1" }))).status).toBe(200);
    expect(existsSync(path.join(data, "media", "done1.mp4"))).toBe(false);
    expect(existsSync(path.join(data, "media", "done1_strip.jpg"))).toBe(false);
    const edit = (await (await sequences.GET(new Request("http://x"), ctx({ key: "all" }))).json()) as { clips: unknown[] };
    expect(edit.clips).toEqual([]);
  });

  it("says plainly when a take's file is gone", async () => {
    const r = await use.POST(json("POST", { purpose: "h3" }), ctx({ id: "nofile" }));
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toMatch(/file is missing/);
  });
});

describe("the edit", () => {
  it("keeps clips cuttable when saved", async () => {
    const r = await sequences.PUT(json("PUT", { clips: [{ id: "c1", take: "nofile", in: 7, out: 2 }] }), ctx({ key: "all" }));
    const { clips } = (await r.json()) as { clips: { in: number; out: number }[] };
    expect(clips[0].out).toBeGreaterThan(clips[0].in);
    expect((await sequences.GET(new Request("http://x"), ctx({ key: "../etc" }))).status).toBe(400);
  });
});

describe("storage", () => {
  it("reports what's kept, and won't move while a take renders", async () => {
    const info = (await (await storage.GET()).json()) as { root: string; usage: { total: number } };
    expect(realpathSync(info.root)).toBe(realpathSync(data));
    expect(info.usage.total).toBeGreaterThan(0);
    // A take still rendering would land in the old folder.
    expect((await storage.PUT(json("PUT", { root: path.join(root, "elsewhere") }))).status).toBe(409);
  });
});

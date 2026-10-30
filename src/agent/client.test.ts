import { describe, expect, it, vi } from "vitest";
import { CREDITS_PER_USD } from "@/lib/comfy/credits";
import type { WorkflowSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { BudgetError, NovaError, NovaField, type Preflight } from "./client";

const spec: WorkflowSpec = { kind: "workflow", recipe: "r1", values: {} };
const free: Preflight = { meta: null, nodes: 3, issues: [], warnings: [], paid: [], price: null, blocker: null };
const priced = (credits: number): Preflight => ({
  ...free,
  paid: ["PaidNode"],
  price: { minUsd: credits / CREDITS_PER_USD, maxUsd: credits / CREDITS_PER_USD, approximate: false, nodes: [{ node: "1", classType: "PaidNode", minUsd: credits / CREDITS_PER_USD, maxUsd: credits / CREDITS_PER_USD, approximate: false, per: null, text: null }] },
});
const job = (p: Partial<Job>): Job => ({ id: "j1", kind: "shot", title: "A shot", spec: spec as never, status: "done", createdAt: 1, updatedAt: 1, progress: { stage: "Done", pct: 1 }, ...p });

/** A fake app: routes answered from a table, every request recorded. */
function app(routes: Record<string, (body: unknown) => unknown | Response>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, path: u.pathname, body });
    const handler = routes[`${method} ${u.pathname}`];
    if (!handler) return Response.json({ error: `No route ${method} ${u.pathname}` }, { status: 404 });
    const out = handler(body);
    return out instanceof Response ? out : Response.json(out);
  });
  return { nova: new NovaField({ url: "http://nova.test:4317/", fetch: fetch as typeof globalThis.fetch }), calls };
}

describe("NovaField client", () => {
  it("talks to the configured app and turns its paths into full URLs", async () => {
    const { nova, calls } = app({ "GET /api/status": () => ({ online: true }) });
    expect(await nova.status()).toEqual({ online: true });
    expect(calls[0].path).toBe("/api/status");
    expect(nova.absolute("/api/files/media/a.mp4")).toBe("http://nova.test:4317/api/files/media/a.mp4");
    expect(nova.absolute("https://elsewhere/x.png")).toBe("https://elsewhere/x.png");
  });

  it("passes on the app's own error text", async () => {
    const { nova } = app({ "GET /api/jobs/nope": () => Response.json({ error: "No such take." }, { status: 404 }) });
    await expect(nova.take("nope")).rejects.toMatchObject({ message: "No such take.", status: 404 });
  });

  it("says how to start the app when nothing answers", async () => {
    const nova = new NovaField({ url: "http://nova.test:1", fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch });
    await expect(nova.status()).rejects.toThrow(/isn't answering at http:\/\/nova.test:1.*pnpm dev/);
  });

  it("filters takes by project, Unsorted, live status, words and count", async () => {
    const jobs = [
      job({ id: "a", project: "p1", title: "Neon alley", status: "done", favorite: true }),
      job({ id: "b", title: "Harbour at dawn", status: "running" }),
      job({ id: "c", project: "p1", title: "Neon rooftop", status: "failed" }),
    ];
    const { nova } = app({ "GET /api/jobs": () => jobs });
    const ids = async (f: Parameters<NovaField["takes"]>[0]) => (await nova.takes(f)).map((j) => j.id);
    expect(await ids({ project: "p1" })).toEqual(["a", "c"]);
    expect(await ids({ project: "unsorted" })).toEqual(["b"]);
    expect(await ids({ status: "live" })).toEqual(["b"]);
    expect(await ids({ query: "neon", favorite: true })).toEqual(["a"]);
    expect(await ids({ limit: 1 })).toEqual(["a"]);
  });

  it("waits for a take to finish, and gives up when the time is up", async () => {
    const states: Job["status"][] = ["queued", "running", "done"];
    const { nova } = app({ "GET /api/jobs/j1": () => job({ status: states.shift() ?? "done" }) });
    const sleep = vi.fn(async () => {});
    expect((await nova.wait("j1", { sleep })).status).toBe("done");
    expect(sleep).toHaveBeenCalledTimes(2);

    const stuck = app({ "GET /api/jobs/j1": () => job({ status: "running" }) });
    expect((await stuck.nova.wait("j1", { timeoutMs: 0, sleep })).status).toBe("running");
  });
});

describe("generate and the credit guard", () => {
  it("queues local GPU work with a 0-credit ceiling, and sends the ceiling to the app", async () => {
    const { nova, calls } = app({ "POST /api/preflight": () => free, "POST /api/jobs": () => [job({ status: "preparing" })] });
    const { jobs, budget } = await nova.generate([spec, spec], { maxCredits: 0, project: "p1" });
    expect(jobs).toHaveLength(1);
    expect(budget).toMatchObject({ ok: true, credits: { min: 0, max: 0 } });
    expect(calls.filter((c) => c.path === "/api/preflight")).toHaveLength(2);
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/api/jobs", body: { specs: [spec, spec], project: "p1", maxCredits: 0 } });
  });

  it("queues a paid render that fits the ceiling", async () => {
    const { nova, calls } = app({ "POST /api/preflight": () => priced(12.4), "POST /api/jobs": () => [job({})] });
    const { budget } = await nova.generate([spec], { maxCredits: 15 });
    expect(budget.credits.max).toBe(12.4);
    expect(calls.some((c) => c.path === "/api/jobs")).toBe(true);
  });

  it("never queues anything that could go over the ceiling", async () => {
    const { nova, calls } = app({ "POST /api/preflight": () => priced(12.4), "POST /api/jobs": () => [job({})] });
    const err = await nova.generate([spec, spec], { maxCredits: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetError);
    expect((err as BudgetError).budget.credits.max).toBe(24.8);
    expect(calls.some((c) => c.path === "/api/jobs")).toBe(false);
  });

  it("never queues paid nodes without a ceiling, or with no price, a blocker or graph problems", async () => {
    const cases: [Preflight, RegExp][] = [
      [{ ...free, paid: ["PaidNode"], price: null }, /could not be worked out/],
      [{ ...free, blocker: "Add an API key." }, /Add an API key/],
      [{ ...free, issues: [{ classType: "KSampler", input: "steps", message: "too high" }] }, /KSampler.steps: too high/],
    ];
    for (const [plan, why] of cases) {
      const { nova, calls } = app({ "POST /api/preflight": () => plan, "POST /api/jobs": () => [job({})] });
      await expect(nova.generate([spec], { maxCredits: 1000 })).rejects.toThrow(why);
      expect(calls.some((c) => c.path === "/api/jobs")).toBe(false);
    }
    const { nova, calls } = app({ "POST /api/preflight": () => priced(1), "POST /api/jobs": () => [job({})] });
    await expect(nova.generate([spec], {} as { maxCredits: number })).rejects.toThrow(NovaError);
    expect(calls).toHaveLength(0);
  });

  it("reports the app's own refusal when its re-check fails", async () => {
    const { nova } = app({ "POST /api/preflight": () => free, "POST /api/jobs": () => Response.json({ error: "Refused: over the 0-credit ceiling." }, { status: 402 }) });
    await expect(nova.generate([spec], { maxCredits: 0 })).rejects.toMatchObject({ status: 402, message: /over the 0-credit ceiling/ });
  });
});

describe("the edit", () => {
  it("reads and replaces a project's edit", async () => {
    const saved = [{ id: "c1", take: "a", in: 0, out: 4, join: "cut" }];
    const { nova, calls } = app({ "GET /api/sequences/p1": () => ({ key: "p1", clips: saved }), "PUT /api/sequences/p1": (b) => ({ key: "p1", clips: (b as { clips: unknown }).clips }) });
    expect((await nova.sequence("p1")).clips).toEqual(saved);
    await nova.setSequence("p1", ["a", "b"]);
    expect(calls.at(-1)).toMatchObject({ method: "PUT", body: { clips: ["a", "b"], origin: "agent" } });
  });
});

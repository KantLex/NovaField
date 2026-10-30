// ComfyUI's status is pushed to the tabs: right away when they start watching, and the moment
// ComfyUI goes away, with no polling in between.

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startFakeComfy } from "@/test/fakeComfy";

const comfy = await startFakeComfy();
process.chdir(await mkdtemp(path.join(os.tmpdir(), "nf-status-")));
process.env.COMFY_URL = comfy.url;

const { STATUS } = await import("./status");
const { HUB } = await import("./hub");
type Status = Awaited<ReturnType<typeof STATUS.read>>;

afterAll(() => HUB.close());

const next = (seen: Status[], ok: (s: Status) => boolean, ms = 3000) =>
  new Promise<Status>((resolve, reject) => {
    const end = Date.now() + ms;
    const t = setInterval(() => {
      const hit = seen.find(ok);
      if (hit) {
        clearInterval(t);
        resolve(hit);
      } else if (Date.now() > end) {
        clearInterval(t);
        reject(new Error(`no matching status in ${ms} ms: ${JSON.stringify(seen.map((s) => s.online))}`));
      }
    }, 10);
  });

describe("the status feed", () => {
  const seen: Status[] = [];
  let unwatch = () => {};

  it("tells a new watcher where things stand", async () => {
    unwatch = STATUS.watch((s) => seen.push(s));
    const s = await next(seen, (x) => x.online);
    expect(s.gpu?.name).toBe("Fake GPU");
    expect(s.queue).toEqual({ running: 0, pending: 0 });
    await next(seen, () => HUB.connected);
    expect(comfy.sockets()).toBe(1);
  });

  it("says ComfyUI is offline as soon as it stops", async () => {
    const before = Date.now();
    await comfy.close();
    const s = await next(seen, (x) => !x.online);
    expect(s.gpu).toBeNull();
    expect(Date.now() - before).toBeLessThan(3000); // the 30 s timer had no part in it
  });

  it("only sends a change", () => {
    const flips = seen.map((s) => s.online).filter((o, i, a) => i === 0 || o !== a[i - 1]);
    expect(flips).toEqual(seen.map((s) => s.online));
    unwatch();
  });
});

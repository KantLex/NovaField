// The hub's link to ComfyUI while ComfyUI can't be reached (the GPU machine is off): a real
// WebSocket to a port nothing listens on.

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ wsUrl: () => "ws://127.0.0.1:1/ws" }));
vi.mock("./comfy", () => ({ forgetObjectInfo: () => {} }));

// Count the sockets the hub dials.
let dialled = 0;
const Real = globalThis.WebSocket;
vi.stubGlobal(
  "WebSocket",
  class extends Real {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      dialled++;
    }
  },
);

const { HUB } = await import("./hub");
afterAll(() => HUB.close());

describe("the link to ComfyUI", () => {
  it("keeps trying again, without crashing, while ComfyUI is unreachable", async () => {
    HUB.ensure();
    // The first try fails at once; the next comes a second later.
    await new Promise((r) => setTimeout(r, 1400));
    expect(HUB.connected).toBe(false);
    expect(dialled).toBeGreaterThanOrEqual(2);
  });
});

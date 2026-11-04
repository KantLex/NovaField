// @vitest-environment happy-dom
// Getting a model's missing files: a Download button through the NovaField nodes, progress and
// Cancel while it runs, or the links and folders when the nodes are older.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODELS } from "@/lib/engines/capabilities";
import { MODEL_FILES, type ModelsStatus } from "@/lib/modelFiles";
import { GetModels, useModels } from "./GetModels";

const files = [MODELS.wanAti, MODELS.clipVision];
const posts: { url: string; body: unknown }[] = [];
const status = (over: Partial<ModelsStatus> = {}): ModelsStatus => ({
  cloud: false,
  pack: "0.5.0",
  files: Object.fromEntries(Object.keys(MODEL_FILES).map((f) => [f, { installed: f === MODELS.clipVision }])),
  ...over,
});

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json(url === "/api/models" && !init ? useModels.getState().status : { queued: [MODELS.wanAti] });
  });
});
afterEach(() => {
  cleanup();
  act(() => useModels.setState({ status: null }));
});

describe("getting a model's files", () => {
  it("offers to download just the missing files, with their size", async () => {
    act(() => useModels.setState({ status: status() }));
    render(<GetModels name="Wan 2.1 ATI" files={files} />);
    expect(screen.getByText("Wan 2.1 ATI needs these files on your ComfyUI PC.")).toBeTruthy();
    expect(screen.queryByText(MODELS.clipVision)).toBeNull(); // already there
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Download 17\.1 GB/ })));
    expect(posts[0]).toEqual({ url: "/api/models", body: { files: [MODELS.wanAti] } });
  });

  it("shows progress and a Cancel while it downloads", async () => {
    const s = status();
    s.files[MODELS.wanAti] = { installed: false, job: { state: "downloading", done: 4e9, total: 17.1e9 } };
    act(() => useModels.setState({ status: s }));
    render(<GetModels name="Wan 2.1 ATI" files={files} />);
    expect(screen.getByText("4 GB / 17.1 GB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: `Cancel ${MODELS.wanAti}` })));
    expect(posts[0]).toEqual({ url: "/api/models/cancel", body: { file: MODELS.wanAti } });
  });

  it("with older nodes, gives each file's link and folder instead", () => {
    act(() => useModels.setState({ status: status({ pack: null }) }));
    render(<GetModels name="Wan 2.1 ATI" files={files} />);
    expect(screen.getByRole("link", { name: MODELS.wanAti }).getAttribute("href")).toBe(MODEL_FILES[MODELS.wanAti].url);
    expect(screen.getByText("Goes in models/diffusion_models")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("asks again when the PC couldn't be reached, while a panel is on screen", async () => {
    // A fresh copy of the module: the tests above leave its poll timer running.
    vi.resetModules();
    const { GetModels, useModels } = await import("./GetModels");
    vi.useFakeTimers();
    try {
      let up = false;
      vi.stubGlobal("fetch", async () => (up ? Response.json(status()) : Response.json({ error: "offline" }, { status: 502 })));
      const { unmount } = render(<GetModels name="Wan 2.1 ATI" files={files} />);
      await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
      expect(useModels.getState().status).toBeNull();
      up = true;
      await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
      expect(screen.getByRole("button", { name: /Download 17\.1 GB/ })).toBeTruthy();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays out of the way on Comfy Cloud and when nothing is missing", () => {
    act(() => useModels.setState({ status: status({ cloud: true }) }));
    const { container, rerender } = render(<GetModels name="Wan 2.1 ATI" files={files} />);
    expect(container.textContent).toBe("");
    act(() => useModels.setState({ status: status() }));
    rerender(<GetModels name="CLIP vision" files={[MODELS.clipVision]} />);
    expect(container.textContent).toBe("");
  });
});

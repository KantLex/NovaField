// @vitest-environment happy-dom
// What a finished take offers next, and where each step sends its picture or clip.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/jobs";
import { useToasts } from "./api";
import { useTakeDrag } from "./dragTakes";
import { Drop } from "./Drop";
import { useG } from "./henshin/state";
import { DEFAULT_SHOT, useLive, useStudio } from "./state";
import { TakeActions } from "./TakeActions";
import { VideoTake } from "./TakePlayer";
import { useRecipes } from "./workflows/store";

// Menus open and close at once: the test DOM cancels animations mid-way and reports it as an error.
MotionGlobalConfig.skipAnimations = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const calls: { url: string; method: string; body: unknown }[] = [];
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method: init?.method ?? "GET", body });
  if (/\/api\/jobs\/\w+\/(use|frame)$/.test(url)) return Response.json({ name: "pic.png", kind: "image", url: "/api/files/uploads/pic.png", label: "Night market hero" });
  if (url.startsWith("/api/sequences/")) return Response.json({ clips: body.clips });
  return Response.json([]);
});

const base = { createdAt: 1, updatedAt: 1, status: "done", progress: { stage: "Done", pct: 1 } } as const;
const imageTake = { ...base, id: "img1", kind: "workflow", title: "Hero still", image: "/api/files/media/img1.png", spec: { kind: "workflow", recipe: "flux", values: {} } } as unknown as Job;
const videoTake = {
  ...base,
  id: "vid1",
  kind: "shot",
  title: "Alley push",
  video: "/api/files/media/vid1.mp4",
  poster: "/api/files/media/vid1.jpg",
  meta: { width: 1280, height: 720, fps: 24, seconds: 5 },
  spec: { ...DEFAULT_SHOT, kind: "shot", seed: 1 },
} as unknown as Job;

const toasts = () => useToasts.getState().toasts.map((t) => t.text);

beforeEach(() => {
  calls.length = 0;
  push.mockClear();
  window.history.pushState({}, "", "/workflows");
  act(() => {
    useStudio.setState({ shot: { ...DEFAULT_SHOT, cast: [] } });
    useLive.setState({ jobs: { img1: imageTake, vid1: videoTake }, focus: "img1" });
    useRecipes.setState({ list: [] });
    useToasts.setState({ toasts: [] });
    useTakeDrag.setState({ media: null });
  });
});
afterEach(cleanup);

const useAs = async (item: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Use as" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};

describe("an image take", () => {
  it("leads with Animate and offers every place its picture can go", async () => {
    render(<TakeActions job={imageTake} inline />);
    expect(screen.getByRole("button", { name: /Animate/ })).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
    expect(screen.queryByText("Add to edit")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use as" }));
    const items = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(items).toEqual(["First frame of the next shot", "Last frame of the next shot", "Cast member", "Still for motion paths", "Style image for Restyle"]);
  });

  it("Animate makes it the first frame and opens the Studio, switching off an image-only model", async () => {
    act(() => {
      useRecipes.setState({ list: [{ id: "flux", output: "image" }] as never });
      useStudio.getState().patch({ engine: "flux" });
    });
    render(<TakeActions job={imageTake} inline />);
    fireEvent.click(screen.getByRole("button", { name: /Animate/ }));
    await waitFor(() => expect(useStudio.getState().shot.startFrame?.url).toBe("/api/files/uploads/pic.png"));
    expect(calls[0]).toMatchObject({ url: "/api/jobs/img1/use", body: { purpose: "image" } });
    expect(useStudio.getState().shot.engine).toBeUndefined();
    expect(useLive.getState().focus).toBeNull();
    expect(push).toHaveBeenCalledWith("/");
    expect(toasts().join()).toMatch(/MiniMax H3/);
  });

  it("joins the cast under a handle, and says so when the cast is full", async () => {
    render(<TakeActions job={imageTake} inline />);
    await useAs("Cast member");
    await waitFor(() => expect(useStudio.getState().shot.cast).toHaveLength(1));
    expect(useStudio.getState().shot.cast[0].label).toBe("Nightmarkethero");

    act(() => useStudio.getState().patch({ cast: Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, kind: "image", url: "" })) }));
    await useAs("Cast member");
    await waitFor(() => expect(toasts().at(-1)).toMatch(/cast is full/));
    expect(useStudio.getState().shot.cast).toHaveLength(9);
  });

  it("goes to Henshin as a still to draw motion paths on", async () => {
    render(<TakeActions job={imageTake} inline />);
    await useAs("Still for motion paths");
    await waitFor(() => expect(useG.getState().still?.url).toBe("/api/files/uploads/pic.png"));
    expect(useG.getState().mode).toBe("paths");
    expect(push).toHaveBeenCalledWith("/henshin");
  });
});

describe("a video take", () => {
  it("leads with Continue, Restyle and Add to edit", () => {
    render(<TakeActions job={videoTake} inline />);
    for (const label of ["Continue", "Restyle", "Add to edit"]) expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Animate/ })).toBeNull();
  });

  it("Add to edit puts it at the end of the current edit", async () => {
    render(<TakeActions job={videoTake} inline />);
    fireEvent.click(screen.getByRole("button", { name: /Add to edit/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/sequences/all");
    expect((put.body as { clips: { take: string; out: number }[] }).clips.at(-1)).toMatchObject({ take: "vid1", out: 5 });
  });

  it("Restyle loads the clip into Henshin", async () => {
    render(<TakeActions job={videoTake} inline />);
    fireEvent.click(screen.getByRole("button", { name: /Restyle/ }));
    await waitFor(() => expect(useG.getState().mode).toBe("restyle"));
    expect(calls[0]).toMatchObject({ url: "/api/jobs/vid1/use", body: { purpose: "h3" } });
    expect(useG.getState().h3Source?.label).toBe("Alley push");
    expect(push).toHaveBeenCalledWith("/henshin");
  });

  it("on a thumbnail, shows Continue, Reuse, download and delete as icons, and project and assets under More", async () => {
    render(<TakeActions job={videoTake} />);
    expect(screen.getByRole("button", { name: "Continue this shot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reuse prompt and references" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete take" })).toBeTruthy();
    const download = screen.getByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toBe("/api/files/media/vid1.mp4");
    expect(download.getAttribute("download")).toBe("alley-push.mp4");
    expect(screen.queryByRole("button", { name: "Move to project" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save to assets" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const items = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(items).toEqual(expect.arrayContaining(["Restyle in Henshin", "Add to the edit", "Use last frame as first frame", "Move to project", "Save to assets", "Rename"]));
    expect(items).not.toContain("Delete take");

    // Project and assets open inside the same menu, with a way back.
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to project" }));
    expect(await screen.findByRole("menuitem", { name: "Unsorted" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move to project" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save to assets" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("on a thumbnail, an image take shows Animate and Reuse", () => {
    render(<TakeActions job={imageTake} />);
    expect(screen.getByRole("button", { name: "Animate this picture" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reuse prompt and references" })).toBeTruthy();
  });

  it("sends the paused moment from the player as a picture", async () => {
    render(<VideoTake job={videoTake} autoPlay={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Use this frame" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Last frame of the next shot" }));
    await waitFor(() => expect(useStudio.getState().shot.endFrame?.url).toBe("/api/files/uploads/pic.png"));
    expect(calls[0]).toMatchObject({ url: "/api/jobs/vid1/frame", body: { at: 0 } });
  });
});

describe("dragging a take", () => {
  it("outlines only the slots that can use it", () => {
    render(
      <>
        <Drop purpose="image" accept="image/*" onAsset={() => {}} className="image-slot">
          {() => "image"}
        </Drop>
        <Drop purpose="h3" accept="video/*" onAsset={() => {}} className="video-slot">
          {() => "video"}
        </Drop>
      </>,
    );
    act(() => useTakeDrag.setState({ media: ["image"] }));
    const image = document.querySelector(".image-slot")!.className;
    expect(image).toMatch(/outline-dashed/);
    // outline-none would hide the outline whatever comes after it.
    expect(image).not.toMatch(/outline-none/);
    expect(document.querySelector(".video-slot")!.className).toMatch(/outline-none/);
  });
});

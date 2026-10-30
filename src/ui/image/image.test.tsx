// @vitest-environment happy-dom
// The Image page: which picture is worked on, what each tool sends, and a picture's versions.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageSpec, JobSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { useToasts } from "../api";
import { useLive } from "../state";
import { TakeActions } from "../TakeActions";
import { useRecipes } from "../workflows/store";
import { beforeOf, respin, sceneOf, useLab, versions } from "./state";
import { ToolPanel } from "./ToolPanel";
import { Trail } from "./Trail";
import { Viewer } from "./Viewer";

MotionGlobalConfig.skipAnimations = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const calls: { url: string; method: string; body: { specs?: JobSpec[]; purpose?: string } }[] = [];
let made = 0;
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method: init?.method ?? "GET", body });
  if (/\/api\/jobs\/\w+\/use$/.test(url)) return Response.json({ name: `in_${url.split("/")[3]}.png`, kind: "image", url: "/api/files/uploads/in.png", width: 832, height: 1216 });
  if (url === "/api/jobs") return Response.json(body.specs.map((spec: JobSpec) => ({ ...base, id: `new${++made}`, kind: spec.kind, spec, status: "queued" })));
  return Response.json([]);
});

const base = { createdAt: 1, updatedAt: 1, status: "done", progress: { stage: "Done", pct: 1 }, title: "t" } as const;
const still = { ...base, id: "img1", kind: "workflow", title: "Hero still", image: "/api/files/media/img1.png", meta: { prompt: "a woman by the harbour" }, spec: { kind: "workflow", recipe: "zimg", values: {} } } as unknown as Job;
const step = (id: string, from: string, tool: ImageSpec["tool"], createdAt: number, over: Partial<Job> = {}): Job =>
  ({
    ...base,
    id,
    kind: "image",
    createdAt,
    image: `/api/files/media/${id}.png`,
    spec: { kind: "image", tool, image: { name: `in_${from}.png`, kind: "image", url: `/api/files/uploads/${from}.png` }, prompt: "make it night", from, seed: 1, scale: 2, aspect: "16:9" },
    ...over,
  }) as Job;
const night = step("ed1", "img1", "edit", 2);
const bigger = step("up1", "ed1", "upscale", 3);

const caps = { h3: true, image: { qwen: true, kontext: true, upscale: true } };

beforeEach(() => {
  calls.length = 0;
  push.mockClear();
  window.history.pushState({}, "", "/image");
  act(() => {
    useLive.setState({ jobs: { img1: still, ed1: night, up1: bigger }, focus: "img1", status: { caps } as never });
    useLab.setState({ tool: "edit", asset: null, edit: "", count: 1, scale: 2, creativity: 0.35, detail: "", fill: "", aspect: "16:9", model: undefined });
    useRecipes.setState({ list: [{ id: "zimg", name: "Z Image", output: "image", missing: [], fields: [{ id: "3.seed", kind: "seed", role: "seed", max: 1000 }] }] as never });
    useToasts.setState({ toasts: [] });
  });
});
afterEach(cleanup);

describe("a picture's history", () => {
  it("starts from the take it was made from and lists every step after it", () => {
    const list = versions(useLive.getState().jobs, bigger, null);
    expect(list.map((v) => v.key)).toEqual(["job:img1", "ed1", "up1"]);
    expect(versions(useLive.getState().jobs, still, null).map((v) => v.key)).toEqual(["job:img1", "ed1", "up1"]);
  });

  it("starts from an upload when the first step was made from one", () => {
    const upload = { name: "photo.png", kind: "image" as const, url: "/u/photo.png" };
    const fromUpload = step("ed2", "x", "edit", 5, { spec: { kind: "image", tool: "edit", image: upload, prompt: "rain", seed: 1 } } as Partial<Job>);
    const list = versions({ ed2: fromUpload }, null, upload);
    expect(list.map((v) => v.key)).toEqual(["asset:photo.png", "ed2"]);
    expect(list[0].asset).toBe(upload);
  });

  it("guides an upscale of a step with what the original take showed, not the edit instruction", () => {
    expect(sceneOf(bigger, useLive.getState().jobs)).toBe("a woman by the harbour");
    expect(sceneOf(still, useLive.getState().jobs)).toBe("a woman by the harbour");
  });

  it("compares a step against the picture it was made from", () => {
    expect(beforeOf(bigger, useLive.getState().jobs)).toBe("/api/files/media/ed1.png");
    expect(beforeOf(still, useLive.getState().jobs)).toBeNull();
  });

  it("shows the versions in a row, and clicking one shows it", () => {
    render(<Trail list={versions(useLive.getState().jobs, still, null)} current="img1" />);
    expect(screen.getByRole("button", { name: "Original" }).title).toBe("Hero still");
    fireEvent.click(screen.getByRole("button", { name: "Upscale ×2" }));
    expect(useLive.getState().focus).toBe("up1");
  });
});

describe("the tools", () => {
  it("edits the picture on show with the words given, as many versions as asked", async () => {
    act(() => useLab.setState({ edit: "make it night", count: 2 }));
    render(<ToolPanel job={still} asset={null} size={{ width: 832, height: 1216 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit ×2" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/jobs")).toBe(true));
    expect(calls[0]).toMatchObject({ url: "/api/jobs/img1/use", body: { purpose: "image" } });
    const specs = calls.find((c) => c.url === "/api/jobs")!.body.specs as ImageSpec[];
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ kind: "image", tool: "edit", prompt: "make it night", from: "img1", model: "qwen", image: { name: "in_img1.png" } });
    expect(specs[0].seed).not.toBe(specs[1].seed);
    expect(useLive.getState().focus).toBe("new1");
  });

  it("guides an upscale with the picture's own prompt unless one is typed", async () => {
    act(() => useLab.setState({ tool: "upscale" }));
    render(<ToolPanel job={still} asset={null} size={{ width: 832, height: 1216 }} />);
    expect(screen.getByText("1664×2432")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/jobs")).toBe(true));
    expect(calls.find((c) => c.url === "/api/jobs")!.body.specs![0]).toMatchObject({ tool: "upscale", prompt: "a woman by the harbour", scale: 2, creativity: 0.35 });
  });

  it("waits for words before editing, and says why a tool can't run", () => {
    render(<ToolPanel job={still} asset={null} size={{ width: 1024, height: 1024 }} />);
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Expand" }));
    fireEvent.click(screen.getByRole("radio", { name: "1:1" }));
    expect(screen.getByText("The picture is already that shape.")).toBeTruthy();
  });

  it("makes more like a take with fresh seeds", () => {
    const again = respin(still.spec, useRecipes.getState().list) as Extract<JobSpec, { kind: "workflow" }>;
    expect(again.values["3.seed"]).toBeLessThan(1000);
    expect(respin({ ...still.spec, recipe: "gone" } as JobSpec, [])).toBeNull();
  });
});

describe("before and after", () => {
  it("offers a comparison for a step, not for an original", () => {
    const { unmount } = render(<Viewer job={night} asset={null} onSize={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByRole("slider", { name: "Before and after" })).toBeTruthy();
    unmount();
    render(<Viewer job={still} asset={null} onSize={() => {}} />);
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
  });
});

describe("a picture take elsewhere", () => {
  it("offers Edit and Upscale; Upscale makes the new picture and shows it on the Image page", async () => {
    window.history.pushState({}, "", "/workflows");
    render(<TakeActions job={still} inline />);
    expect(screen.getByRole("button", { name: "Edit" }).title).toBe("Edit this picture");
    fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/image"));
    expect(calls.find((c) => c.url === "/api/jobs")!.body.specs![0]).toMatchObject({ kind: "image", tool: "upscale", from: "img1", prompt: "a woman by the harbour" });
    expect(useLive.getState().focus).toBe(`new${made}`);
  });

  it("keeps Animate and Reuse as the thumbnail's icons, with Edit and Upscale under More", async () => {
    render(<TakeActions job={still} />);
    expect(screen.queryByRole("button", { name: "Edit this picture" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const items = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(items.slice(0, 2)).toEqual(["Edit this picture", "Upscale ×2"]);
    expect(items).not.toContain("Picture to edit or upscale");
  });
});

// @vitest-environment happy-dom
// The grade sheet: start from a look, check one frame on the GPU, then apply it as a new take.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GRADE } from "@/lib/cinema/grade";
import type { GradeSpec, JobSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { useLive } from "../state";
import { TakeActions } from "../TakeActions";
import { GradeSheet, useGrade } from "./GradeSheet";

MotionGlobalConfig.skipAnimations = true;
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// The test DOM doesn't decode pictures: give every picture the same measured colour.
vi.mock("./labOf", () => ({ labOf: async () => ({ mean: [50, 0, 0], std: [10, 5, 5] }) }));

const calls: { url: string; body: { specs?: JobSpec[]; at?: number; image?: string; film?: unknown; purpose?: string } }[] = [];
const other = {
  id: "vid2",
  kind: "shot",
  title: "Night market",
  status: "done",
  createdAt: 2,
  updatedAt: 2,
  progress: { stage: "Done", pct: 1 },
  video: "/api/files/media/vid2.mp4",
  poster: "/api/files/media/vid2.jpg",
  meta: { fps: 24, seconds: 4 },
  spec: { kind: "shot" },
} as unknown as Job;
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ url, body });
  if (url.endsWith("/use")) return Response.json({ name: "nf_clip.mp4", kind: "video", url: "/api/files/uploads/clip.mp4", fps: 24, frames: 120, width: 1280, height: 720 });
  if (url.endsWith("/frame")) return Response.json({ name: "nf_frame.png", kind: "image", url: "/f.png" });
  if (url === "/api/grade/preview") return Response.json({ url: "/api/comfy-view?filename=graded.png&type=temp" });
  if (url === "/api/jobs") return Response.json(body.specs.map((spec: JobSpec, i: number) => ({ id: `g${i}`, kind: spec.kind, spec, status: "queued" })));
  return Response.json([]);
});

const clip = {
  id: "vid1",
  kind: "shot",
  title: "Alley push",
  status: "done",
  createdAt: 1,
  updatedAt: 1,
  progress: { stage: "Done", pct: 1 },
  video: "/api/files/media/vid1.mp4",
  meta: { fps: 24 },
  spec: { kind: "shot", film: { ...DEFAULT_GRADE, look: "none" }, filmOnGpu: false },
} as unknown as Job;

const withPack = (lensFilm: boolean) => ({ caps: { pack: { lensFilm } } }) as never;

beforeEach(() => {
  calls.length = 0;
  push.mockClear();
  act(() => {
    useLive.setState({ jobs: { vid1: clip }, focus: null, status: withPack(true) });
    useGrade.setState({ job: null, last: { ...DEFAULT_GRADE, look: "moonlight" } });
  });
});
afterEach(cleanup);

describe("grading a clip", () => {
  it("opens from the take's Grade button", () => {
    render(
      <>
        <TakeActions job={clip} inline />
        <GradeSheet />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Grade" }));
    expect(screen.getByRole("dialog", { name: "Grade the film look" })).toBeTruthy();
    // No WebGL here: the clip plays as it is, and the sheet says why.
    expect(screen.getByText(/can't show the live preview/)).toBeTruthy();
  });

  it("checks the paused frame on the GPU with the grade on screen", async () => {
    act(() => useGrade.getState().open("vid1"));
    render(<GradeSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Check exact" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/grade/preview")).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/frame"))!.body).toEqual({ at: 0 });
    expect(calls.find((c) => c.url === "/api/grade/preview")!.body).toMatchObject({ image: "nf_frame.png", film: { look: "moonlight" } });
  });

  it("applies the grade as a new take of the whole clip and remembers it for next time", async () => {
    act(() => useGrade.getState().open("vid1"));
    render(<GradeSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Noir" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to the clip" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/jobs")).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/use"))!.body).toEqual({ purpose: "raw" });
    const spec = calls.find((c) => c.url === "/api/jobs")!.body.specs![0] as GradeSpec;
    expect(spec).toMatchObject({ kind: "grade", from: "vid1", source: { name: "nf_clip.mp4" }, film: { look: "noir" } });
    expect(useGrade.getState()).toMatchObject({ job: null, last: { look: "noir" } });
    expect(useLive.getState().focus).toBe("g0");
  });

  it("previews newer stocks and colour on an older pack, and says how to apply them", () => {
    act(() => useGrade.getState().open("vid1"));
    render(<GradeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /Portra 400/ }));
    expect(screen.getByRole("button", { name: /Portra 400/ }).textContent).toMatch(/Preview only/);
    expect((screen.getByRole("button", { name: "Apply to the clip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/film stock needs NovaField nodes 0\.3\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Kodak 2383/ }));
    fireEvent.change(screen.getByLabelText("Exposure"), { target: { value: "0.5" } });
    expect(screen.getByText(/colour controls and grain size need NovaField nodes 0\.3\.0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset to the look" }));
    expect((screen.getByLabelText("Exposure") as HTMLInputElement).value).toBe("0");
    expect((screen.getByRole("button", { name: "Apply to the clip" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("applies the colour controls on a server with the updated nodes", async () => {
    act(() => {
      useLive.setState({ status: { caps: { pack: { lensFilm: true, filmControls: true, filmLooks: ["none", "kodak_2383", "super8"] } } } as never });
      useGrade.getState().open("vid1");
    });
    render(<GradeSheet />);
    fireEvent.click(screen.getByRole("button", { name: /Super 8/ }));
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.4" } });
    fireEvent.change(screen.getByLabelText("Grain size"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to the clip" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/jobs")).toBe(true));
    expect((calls.find((c) => c.url === "/api/jobs")!.body.specs![0] as GradeSpec).film).toMatchObject({ look: "super8", gateWeave: 0.5, temperature: 0.4, grainSize: 2 });
  });

  it("says what's missing on a server without the NovaField nodes", () => {
    act(() => {
      useLive.setState({ status: withPack(false) });
      useGrade.getState().open("vid1");
    });
    render(<GradeSheet />);
    expect((screen.getByRole("button", { name: "Apply to the clip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs the NovaField nodes/)).toBeTruthy();
  });

  it("matches another shot's colour and adds shutter blur and slow motion", async () => {
    act(() => {
      useLive.setState({ jobs: { vid1: clip, vid2: other }, status: { caps: { interpolate: true, pack: { lensFilm: true, matchColor: true, shutter: true } } } as never });
      useGrade.getState().open("vid1");
    });
    render(<GradeSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Match Night market" }));
    await screen.findByRole("checkbox", { name: /Keep this clip's brightness/ });
    expect(calls.find((c) => c.url === "/api/jobs/vid2/frame")!.body).toEqual({ at: 2 });
    fireEvent.change(screen.getByLabelText("Shutter"), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("radio", { name: "0.5×" }));
    expect(screen.getByText(/sound is left out/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply to the clip" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/jobs")).toBe(true));
    const spec = calls.find((c) => c.url === "/api/jobs")!.body.specs![0] as GradeSpec;
    expect(spec.match).toEqual({ reference: { name: "nf_frame.png", kind: "image", url: "/f.png" }, amount: 1, colourOnly: false });
    expect(spec.motion).toEqual({ shutter: 180, speed: 0.5 });
  });

  it("previews a match on a server without the new nodes, but won't apply it", async () => {
    act(() => {
      useLive.setState({ jobs: { vid1: clip, vid2: other } });
      useGrade.getState().open("vid1");
    });
    render(<GradeSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Match Night market" }));
    expect(await screen.findByText(/Matching another shot needs NovaField nodes 0\.4\.0/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply to the clip" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

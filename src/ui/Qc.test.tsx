// @vitest-environment happy-dom
// Shot QC on a take: flagged thumbnails, the faults under the player, and jumping to each one.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/lib/jobs";
import type { QcReport } from "@/lib/qc";
import { onSeek, QcBadge, QcMenu } from "./Qc";
import { useLive } from "./state";

MotionGlobalConfig.skipAnimations = true;
const posts: string[] = [];
vi.stubGlobal("fetch", async (url: string) => {
  posts.push(url);
  return Response.json(report(100, []));
});

const report = (score: number, issues: QcReport["issues"]): QcReport => ({ version: 1, frames: 120, fps: 24, score, issues, curves: { brightness: [], motion: [], sharpness: [] } });
const take = (qc?: QcReport) => ({ id: "vid1", kind: "shot", title: "Alley push", status: "done", video: "/v.mp4", spec: { kind: "shot" }, qc }) as unknown as Job;
const faulty = report(66, [
  { kind: "frozen", start: 48, end: 51, severity: "high" },
  { kind: "blown", start: 0, end: 119, severity: "medium", amount: 0.08 },
]);

beforeEach(() => {
  posts.length = 0;
  act(() => useLive.setState({ status: { caps: { pack: { shotQc: true } } } as never }));
});
afterEach(cleanup);

describe("shot QC", () => {
  it("flags only takes that need a second look", () => {
    const { container, rerender } = render(<QcBadge job={take(faulty)} />);
    expect(container.textContent).toBe("66");
    expect((container.firstChild as HTMLElement).title).toMatch(/Frozen frames, Blown highlights/);
    rerender(<QcBadge job={take(report(92, [{ kind: "soft", start: 3, end: 5, severity: "low" }]))} />);
    expect(container.textContent).toBe("");
  });

  it("lists the faults and jumps the player to one", async () => {
    const seen: number[] = [];
    const stop = onSeek("vid1", (t) => seen.push(t));
    render(<QcMenu job={take(faulty)} />);
    fireEvent.click(screen.getByText("QC 66 · 2 to check"));
    expect(await screen.findByText("Whole take")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Frozen frames/ }));
    expect(seen).toEqual([2]);
    stop();
  });

  it("offers a check on a clip that hasn't had one", async () => {
    render(<QcMenu job={take()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check take" }));
    await waitFor(() => expect(posts).toEqual(["/api/jobs/vid1/qc"]));
  });
});

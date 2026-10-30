// @vitest-environment happy-dom
// The Studio's floor plan is drawn on a canvas. A recording context reads back where each camera
// mark was drawn, so the test can grab it like a person would.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraKey, CameraPath } from "@/lib/cinema/camera";
import type { CustomRig } from "@/lib/cinema/custom";
import { recordingCanvas, stubLayout } from "@/test/dom";
import { usePrevis } from "../previs";
import { PlanEditor } from "./PlanEditor";

// The lens view is a 3D render; not needed to block a shot on the plan.
vi.mock("../RigView", () => ({ RigView: () => null }));

const key = (t: number, x: number, z: number): CameraKey => ({ t, pos: [x, 1.5, z], target: [0, 1.2, 0], fov: 40, roll: 0 });
const START: CustomRig = { keys: [key(0, -3, 6), key(0.5, 0, 7), key(1, 3, 6)], ease: "linear", actors: [{ from: [0, 0], to: [0, 0], height: 1.75 }], follow: null };

let rig: CustomRig = START;
let canvas: ReturnType<typeof recordingCanvas>;

function Harness() {
  const [r, setR] = useState<CustomRig>(START);
  const path: CameraPath = { version: 1, frames: 121, fps: 24, ease: r.ease, keys: r.keys, actors: r.actors };
  return <PlanEditor path={path} rig={r} aspect={16 / 9} onEdit={(fn) => setR((cur) => (rig = fn(cur)))} onReset={() => {}} onGrab={() => {}} />;
}

beforeEach(() => {
  stubLayout(800, 500);
  canvas = recordingCanvas();
  usePrevis.setState({ inset: false });
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as never;
});
afterEach(cleanup);

const frame = () => act(() => new Promise((r) => setTimeout(r, 50)));

async function setup() {
  rig = START;
  const { container } = render(<Harness />);
  await frame();
  return container.querySelector("canvas")!;
}

describe("the Studio floor plan", () => {
  it("draws the camera marks A, 1 and B", async () => {
    await setup();
    for (const label of ["A", "1", "B"]) expect(canvas.lastText(label)).not.toBeNull();
    const [ax] = canvas.lastText("A")!;
    const [bx] = canvas.lastText("B")!;
    expect(ax).toBeLessThan(bx); // A is left of B, as on the floor
  });

  it("moves a camera mark where it's dragged", async () => {
    const el = await setup();
    const [x, y] = canvas.lastText("B")!;
    fireEvent.pointerDown(el, { clientX: x, clientY: y - 0.5, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: x + 60, clientY: y - 0.5, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(rig.keys[2].pos[0]).toBeGreaterThan(3.5);
    expect(rig.keys[2].pos[2]).toBeCloseTo(6, 0);
    expect(rig.keys[0]).toEqual(START.keys[0]);
  });

  it("nudges the selected mark with the arrow keys and removes a middle one with Delete", async () => {
    const el = await setup();
    // "1" also labels stand-in 1, so place camera point 1 (0, 7) from A (-3, 6) and B (3, 6).
    const [ax, ay] = canvas.lastText("A")!;
    const [bx] = canvas.lastText("B")!;
    const scale = (bx - ax) / 6;
    const [x, y] = [(ax + bx) / 2, ay + scale];
    fireEvent.pointerDown(el, { clientX: x, clientY: y - 0.5, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(rig.keys[1].pos[0]).toBeCloseTo(0.05);
    fireEvent.keyDown(el, { key: "ArrowDown", shiftKey: true });
    expect(rig.keys[1].pos[2]).toBeCloseTo(7.5);
    fireEvent.keyDown(el, { key: "Delete" });
    expect(rig.keys).toHaveLength(2);
  });

  it("won't delete the start or end of the move", async () => {
    const el = await setup();
    const [x, y] = canvas.lastText("A")!;
    fireEvent.pointerDown(el, { clientX: x, clientY: y - 0.5, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    fireEvent.keyDown(el, { key: "Delete" });
    expect(rig.keys).toHaveLength(3);
  });

  it("adds a camera point from the toolbar", async () => {
    const el = await setup();
    fireEvent.click(el.parentElement!.querySelector("button[title='Add a camera point to bend the path']")!);
    expect(rig.keys).toHaveLength(4);
  });
});

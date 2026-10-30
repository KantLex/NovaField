// @vitest-environment happy-dom
// Boxing what to replace: a drag draws a keyframe on the current frame, dragging inside moves it.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Asset, BoxKey } from "@/lib/engines/specs";
import { stubLayout } from "@/test/dom";
import { BoxTracker } from "./BoxTracker";

const W = 1000;
const H = 500;
beforeEach(() => stubLayout(W, H));
afterEach(cleanup);

let keys: BoxKey[] = [];

function Harness() {
  const [k, setK] = useState<BoxKey[]>(keys);
  return <BoxTracker source={{ name: "clip.mp4", kind: "video", url: "/clip.mp4", fps: 16, frames: 81, width: 1280, height: 720 } as Asset} keys={k} shape="rect" onKeys={(n) => setK((keys = n))} />;
}

const setup = () => {
  keys = [];
  const { container } = render(<Harness />);
  const area = container.querySelector(".cursor-crosshair")!;
  const drag = (target: Element, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(target, { clientX: from[0], clientY: from[1], pointerId: 1 });
    fireEvent.pointerMove(area, { clientX: to[0], clientY: to[1], pointerId: 1 });
    fireEvent.pointerUp(area, { pointerId: 1 });
  };
  return { container, area, drag };
};

describe("the box tracker", () => {
  it("keys the box drawn on the current frame, either way round", () => {
    const { area, drag } = setup();
    drag(area, [600, 400], [200, 100]);
    expect(keys).toHaveLength(1);
    expect(keys[0].f).toBe(0);
    expect(keys[0].x).toBeCloseTo(0.2);
    expect(keys[0].y).toBeCloseTo(0.2);
    expect(keys[0].w).toBeCloseTo(0.4);
    expect(keys[0].h).toBeCloseTo(0.6);
  });

  it("ignores a click too small to be a box", () => {
    const { area, drag } = setup();
    drag(area, [300, 300], [305, 302]);
    expect(keys).toEqual([]);
  });

  it("moves the box when dragged from inside, and undo puts it back", () => {
    const { container, area, drag } = setup();
    drag(area, [200, 100], [400, 300]);
    const box = container.querySelector("[data-handle='move']")!;
    drag(box, [300, 200], [400, 250]);
    expect(keys).toHaveLength(1);
    expect(keys[0].x).toBeCloseTo(0.3);
    expect(keys[0].y).toBeCloseTo(0.3);
    expect(keys[0].w).toBeCloseTo(0.2);
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true })));
    expect(keys[0].x).toBeCloseTo(0.2);
  });

  it("resizes from a corner handle", () => {
    const { container, area, drag } = setup();
    drag(area, [200, 100], [400, 300]);
    const corner = container.querySelector("[data-handle='se']")!;
    drag(corner, [400, 300], [500, 400]);
    expect(keys[0].w).toBeCloseTo(0.3);
    expect(keys[0].h).toBeCloseTo(0.6);
  });
});

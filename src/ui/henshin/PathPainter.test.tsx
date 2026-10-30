// @vitest-environment happy-dom
// Drawing motion paths on a still: strokes become paths, a click pins a point, undo takes them back.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Asset, PathPoint, PathTiming } from "@/lib/engines/specs";
import { stubLayout } from "@/test/dom";
import { PathPainter } from "./PathPainter";

const W = 800;
const H = 450;
beforeEach(() => stubLayout(W, H));
afterEach(cleanup);

let latest: { paths: PathPoint[][]; timing: PathTiming[] } = { paths: [], timing: [] };

function Harness() {
  const [state, setState] = useState(latest);
  return (
    <PathPainter
      image={{ name: "still.png", kind: "image", url: "/still.png" } as Asset}
      paths={state.paths}
      timing={state.timing}
      onChange={(paths, timing) => setState((latest = { paths, timing }))}
      ratio={W / H}
      seconds={5}
    />
  );
}

const setup = () => {
  latest = { paths: [], timing: [] };
  const { container } = render(<Harness />);
  const area = container.querySelector(".cursor-crosshair")!;
  const stroke = (pts: [number, number][], shiftKey = false) => {
    fireEvent.pointerDown(area, { clientX: pts[0][0], clientY: pts[0][1], pointerId: 1, shiftKey });
    for (const [x, y] of pts.slice(1)) fireEvent.pointerMove(area, { clientX: x, clientY: y, pointerId: 1, shiftKey });
    fireEvent.pointerUp(area, { pointerId: 1 });
  };
  const key = (key: string, mods: { metaKey?: boolean; shiftKey?: boolean } = {}) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...mods })));
  return { stroke, key };
};

describe("the path painter", () => {
  it("turns a stroke into a path, from where it started to where it ended", () => {
    const { stroke } = setup();
    stroke([[100, 90], [200, 150], [300, 220], [400, 270]]);
    expect(latest.paths).toHaveLength(1);
    const p = latest.paths[0];
    expect(p[0].x).toBeCloseTo(100 / W);
    expect(p[0].y).toBeCloseTo(90 / H);
    expect(p.at(-1)!.x).toBeCloseTo(400 / W);
    expect(p.at(-1)!.y).toBeCloseTo(270 / H);
    expect(latest.timing).toHaveLength(1);
  });

  it("pins a point where you click without dragging", () => {
    const { stroke } = setup();
    stroke([[400, 225]]);
    expect(latest.paths).toEqual([[{ x: 0.5, y: 0.5 }]]);
  });

  it("draws a straight line with Shift, whatever the hand did in between", () => {
    const { stroke } = setup();
    stroke([[0, 0], [300, 400], [80, 45], [800, 450]], true);
    expect(latest.paths[0]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it("undoes and redoes, and Delete removes the selected path", () => {
    const { stroke, key } = setup();
    stroke([[100, 100], [500, 300]]);
    stroke([[600, 50]]);
    expect(latest.paths).toHaveLength(2);
    // The path just drawn is selected.
    key("Delete");
    expect(latest.paths).toHaveLength(1);
    expect(latest.timing).toHaveLength(1);
    key("z", { metaKey: true });
    expect(latest.paths).toHaveLength(2);
    key("z", { metaKey: true });
    expect(latest.paths).toHaveLength(1);
    key("z", { metaKey: true, shiftKey: true });
    expect(latest.paths).toHaveLength(2);
    expect(latest.paths[1]).toEqual([{ x: 0.75, y: 50 / H }]);
  });
});

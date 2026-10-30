// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Pos } from "@/lib/comfy/edit";
import type { Doc } from "./doc";
import { moveNodes, nodesInBox, useGraphPointer } from "./pointer";

const layout = { a: [0, 0] as Pos, b: [400, 0] as Pos, c: [0, 300] as Pos };
const height = () => 100;

describe("graph canvas geometry", () => {
  it("box-selects the nodes a box touches, drawn either way", () => {
    expect(nodesInBox(layout, [-10, -10], [50, 50], height)).toEqual(["a"]);
    expect(nodesInBox(layout, [450, 350], [-10, 50], height).sort()).toEqual(["a", "b", "c"]);
    expect(nodesInBox(layout, [260, 150], [380, 280], height)).toEqual([]);
  });

  it("moves nodes from where the drag began, on whole pixels", () => {
    const origins = new Map([["a", layout.a], ["c", layout.c]]);
    expect(moveNodes(layout, origins, 10.4, -5.6)).toEqual({ a: [10, -6], b: [400, 0], c: [10, 294] });
  });
});

describe("dragging on the graph canvas", () => {
  const setup = () => {
    let doc: Doc | null = { graph: {}, layout };
    const opts = {
      docRef: { current: doc },
      setDoc: vi.fn((v: Doc | null | ((d: Doc | null) => Doc | null)) => {
        doc = typeof v === "function" ? v(doc) : v;
      }),
      record: vi.fn(),
      apply: vi.fn(),
      toWorld: (x: number, y: number): Pos => [x, y],
      setView: vi.fn(),
      viewTouched: { current: false },
      heightOf: height,
      onClear: vi.fn(),
      onSelect: vi.fn(),
      onWired: vi.fn(),
      onLooseWire: vi.fn(),
    };
    const { result } = renderHook(() => useGraphPointer(opts));
    const pointer = (type: string, x: number, y: number) => act(() => void window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y })));
    return { opts, result, pointer, doc: () => doc };
  };

  it("a click on empty canvas clears the selection; a drag pans", () => {
    const { opts, result, pointer } = setup();
    act(() => result.current.startDrag({ kind: "pan", sx: 0, sy: 0, x0: 0, y0: 0, moved: false }));
    pointer("pointerup", 1, 1);
    expect(opts.onClear).toHaveBeenCalledOnce();

    act(() => result.current.startDrag({ kind: "pan", sx: 0, sy: 0, x0: 0, y0: 0, moved: false }));
    pointer("pointermove", 40, 10);
    pointer("pointerup", 40, 10);
    expect(opts.viewTouched.current).toBe(true);
    expect(opts.onClear).toHaveBeenCalledOnce();
  });

  it("moves the grabbed nodes and makes it one undo step", () => {
    const { opts, result, pointer, doc } = setup();
    const before = doc()!;
    act(() => result.current.startDrag({ kind: "move", start: [0, 0], origins: new Map([["b", layout.b]]), before, moved: false }));
    pointer("pointermove", 30, 20);
    pointer("pointerup", 30, 20);
    expect(doc()!.layout.b).toEqual([430, 20]);
    expect(opts.record).toHaveBeenCalledWith(before);
  });

  it("selects what a shift-drag box touches", () => {
    const { opts, result, pointer } = setup();
    act(() => result.current.startDrag({ kind: "marquee", a: [-10, -10], add: true }));
    pointer("pointermove", 450, 50);
    expect(result.current.marquee).toEqual({ a: [-10, -10], b: [450, 50] });
    pointer("pointerup", 450, 50);
    expect(result.current.marquee).toBeNull();
    expect(opts.onSelect).toHaveBeenCalledWith(["a", "b"], true);
  });

  it("drops a wire that was picked up and let go over nothing", () => {
    const { opts, result, pointer, doc } = setup();
    const before = doc()!;
    act(() => result.current.startDrag({ kind: "wire", from: ["a", 0], type: "IMAGE", before }, [5, 5]));
    expect(result.current.wire?.at).toEqual([5, 5]);
    pointer("pointermove", 200, 100);
    expect(result.current.wire?.at).toEqual([200, 100]);
    pointer("pointerup", 200, 100);
    expect(result.current.wire).toBeNull();
    expect(opts.record).toHaveBeenCalledWith(before);
    expect(opts.onWired).not.toHaveBeenCalled();
  });
});

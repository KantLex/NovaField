"use client";

// Dragging on the graph canvas: panning, moving nodes, pulling wires and box-selecting. Drags run
// on window listeners so they keep going outside the canvas, and each one ends in one undo step.

import { useState } from "react";
import { canConnect, connect, NODE_W, type Layout, type Pos } from "@/lib/comfy/edit";
import type { Link } from "@/lib/comfy/graph";
import type { Doc } from "./doc";
import type { View } from "./viewport";

export type Drag =
  | { kind: "pan"; sx: number; sy: number; x0: number; y0: number; moved: boolean }
  | { kind: "move"; start: Pos; origins: Map<string, Pos>; before: Doc; moved: boolean }
  /** `before` is set when an existing wire was picked up by its end. */
  | { kind: "wire"; from: Link; type: string; before?: Doc }
  | { kind: "marquee"; a: Pos; add: boolean };

/** The nodes a box drawn from `a` to `b` touches. */
export function nodesInBox(layout: Layout, a: Pos, b: Pos, heightOf: (id: string) => number): string[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return Object.keys(layout).filter((id) => {
    const [x, y] = layout[id];
    return x < x1 && x + NODE_W > x0 && y < y1 && y + heightOf(id) > y0;
  });
}

/** Move every node in `origins` by (dx, dy), on whole pixels. */
export function moveNodes(layout: Layout, origins: Map<string, Pos>, dx: number, dy: number): Layout {
  const next = { ...layout };
  for (const [id, o] of origins) next[id] = [Math.round(o[0] + dx), Math.round(o[1] + dy)];
  return next;
}

interface Options {
  docRef: React.RefObject<Doc | null>;
  setDoc: React.Dispatch<React.SetStateAction<Doc | null>>;
  /** Make `before` the undo step for a change already on screen. */
  record: (before: Doc) => void;
  /** Change the document as one undo step. */
  apply: (change: (cur: Doc) => Doc) => void;
  toWorld: (cx: number, cy: number) => Pos;
  setView: React.Dispatch<React.SetStateAction<View>>;
  viewTouched: React.RefObject<boolean>;
  heightOf: (id: string) => number;
  /** A click on empty canvas. */
  onClear: () => void;
  onSelect: (ids: string[], add: boolean) => void;
  /** A wire landed on an input. */
  onWired: (node: string) => void;
  /** A new wire was let go over empty canvas: offer nodes that can take it. */
  onLooseWire: (cx: number, cy: number, type: string, from: Link) => void;
}

export function useGraphPointer(o: Options) {
  const [wire, setWire] = useState<{ from: Link; type: string; at: Pos } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Pos; b: Pos } | null>(null);

  const finishWire = (g: Extract<Drag, { kind: "wire" }>, e: PointerEvent) => {
    setWire(null);
    const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const target = under?.closest<HTMLElement>("[data-socket-in]");
    if (!o.docRef.current) return;
    if (target) {
      const node = target.dataset.node!;
      const input = target.dataset.input!;
      if (node !== g.from[0] && canConnect(target.dataset.type!, g.type)) {
        if (g.before) {
          o.record(g.before);
          o.setDoc((cur) => (cur ? { ...cur, graph: connect(cur.graph, g.from, { node, input }) } : cur));
        } else o.apply((cur) => ({ ...cur, graph: connect(cur.graph, g.from, { node, input }) }));
        o.onWired(node);
        return;
      }
    }
    // Pulled off and let go: the wire is gone.
    if (g.before) return o.record(g.before);
    if (under?.closest("[data-canvas]")) o.onLooseWire(e.clientX, e.clientY, g.type, g.from);
  };

  const start = (d: Drag) => {
    if (d.kind === "wire") setWire(null);
    const move = (e: PointerEvent) => {
      if (d.kind === "pan") {
        d.moved ||= Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3;
        if (d.moved) o.viewTouched.current = true;
        o.setView((v) => ({ ...v, x: d.x0 + e.clientX - d.sx, y: d.y0 + e.clientY - d.sy }));
      } else if (d.kind === "move") {
        const [wx, wy] = o.toWorld(e.clientX, e.clientY);
        const dx = wx - d.start[0];
        const dy = wy - d.start[1];
        d.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
        o.setDoc((cur) => (cur ? { ...cur, layout: moveNodes(cur.layout, d.origins, dx, dy) } : cur));
      } else if (d.kind === "wire") {
        const at = o.toWorld(e.clientX, e.clientY);
        setWire({ from: d.from, type: d.type, at });
      } else setMarquee({ a: d.a, b: o.toWorld(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (d.kind === "pan" && !d.moved) o.onClear();
      else if (d.kind === "move" && d.moved) o.record(d.before);
      else if (d.kind === "wire") finishWire(d, e);
      else if (d.kind === "marquee") {
        setMarquee(null);
        const doc = o.docRef.current;
        if (doc) o.onSelect(nodesInBox(doc.layout, d.a, o.toWorld(e.clientX, e.clientY), o.heightOf), d.add);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Start a drag; a wire shows from where the pointer is right away. */
  const startDrag = (d: Drag, at?: Pos) => {
    start(d);
    if (d.kind === "wire" && at) setWire({ from: d.from, type: d.type, at });
  };

  return { wire, marquee, startDrag };
}

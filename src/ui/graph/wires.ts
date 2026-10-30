// Where wires run on the canvas: from an output dot on a node's right edge to an input dot on its
// left, as a horizontal S-curve. Pure geometry from the document and each node's rows.

import { HEAD_H, NODE_W, ROW_H, type Pos, type rowsOf } from "@/lib/comfy/edit";
import { isLink } from "@/lib/comfy/graph";
import type { Doc } from "./doc";
import { typeColor } from "./info";

export type Rows = Map<string, ReturnType<typeof rowsOf>>;

export interface Wire {
  key: string;
  d: string;
  color: string;
  to: { node: string; input: string };
  /** Feeds a node that won't run. */
  idle: boolean;
  selected: boolean;
}

export const curve = (a: Pos, b: Pos) => {
  const dx = Math.max(40, Math.abs(b[0] - a[0]) / 2);
  return `M${a[0]},${a[1]} C${a[0] + dx},${a[1]} ${b[0] - dx},${b[1]} ${b[0]},${b[1]}`;
};

export const outPos = (doc: Doc, id: string, slot: number): Pos => [doc.layout[id][0] + NODE_W, doc.layout[id][1] + HEAD_H + slot * ROW_H + ROW_H / 2];

export function inPos(doc: Doc, rows: Rows, id: string, input: string): Pos | null {
  const r = rows.get(id);
  const i = r?.inputs.findIndex((x) => x.name === input) ?? -1;
  if (!r || i < 0) return null;
  return [doc.layout[id][0], doc.layout[id][1] + HEAD_H + (r.outputs.length + i) * ROW_H + ROW_H / 2];
}

/** Every wire in the graph, coloured by the type it carries. */
export function wiresOf(doc: Doc, rows: Rows, runs: Set<string>, selected: { node: string; input: string } | null): Wire[] {
  const out: Wire[] = [];
  for (const [id, n] of Object.entries(doc.graph)) {
    for (const [input, v] of Object.entries(n.inputs)) {
      if (!isLink(v) || !doc.layout[v[0]] || !doc.layout[id]) continue;
      const b = inPos(doc, rows, id, input);
      if (!b) continue;
      const type = rows.get(v[0])?.outputs[v[1]]?.type ?? "*";
      out.push({
        key: `${id}.${input}`,
        d: curve(outPos(doc, v[0], v[1]), b),
        color: typeColor(type),
        to: { node: id, input },
        idle: !runs.has(id),
        selected: selected?.node === id && selected.input === input,
      });
    }
  }
  return out;
}

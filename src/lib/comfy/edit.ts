// Graph mode's model: what a node shows (sockets and values), what may wire to what, and the
// edits (add, remove, connect, duplicate) as pure functions on an API-format graph.

import { isLink, type ApiGraph, type InputValue, type Link } from "./graph";
import { enumOptions, inputType, prune, typesMatch, type InputSpec, type NodeInfo, type ObjectInfo } from "./validate";

export type Pos = [number, number];
export type Layout = Record<string, Pos>;

const VALUE_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "ENUM", "COMBO"]);
const DYNAMIC = new Set(["COMFY_AUTOGROW_V3", "COMFY_DYNAMICCOMBO_V3"]);

export interface InputRow {
  name: string;
  /** Type it takes: IMAGE, MODEL… or INT, STRING, ENUM for values. */
  type: string;
  spec?: InputSpec;
  /** Edited in place (a number, text, list or switch) unless something is wired in. */
  value: boolean;
  required: boolean;
}

export interface OutputRow {
  name: string;
  type: string;
}

/** A spec that is a value widget rather than a socket (forceInput makes a value socket-only). */
export const isValueSpec = (spec: InputSpec) => VALUE_TYPES.has(inputType(spec)) && !(spec[1] as { forceInput?: boolean } | undefined)?.forceInput;

/** The rows a node card shows: its outputs, then its inputs in the server's order, plus any extras it carries. */
export function rowsOf(classType: string, inputs: Record<string, InputValue>, info: ObjectInfo): { outputs: OutputRow[]; inputs: InputRow[] } {
  const def = info[classType];
  if (!def) {
    return {
      outputs: [],
      inputs: Object.entries(inputs).map(([name, v]) => ({ name, type: isLink(v) ? "*" : typeof v === "number" ? "FLOAT" : "STRING", value: !isLink(v), required: false })),
    };
  }
  const order = (def as NodeInfo & { input_order?: { required?: string[]; optional?: string[] } }).input_order;
  const req = def.input.required ?? {};
  const opt = def.input.optional ?? {};
  const names = [...(order?.required ?? Object.keys(req)), ...(order?.optional ?? Object.keys(opt))];
  const rows: InputRow[] = [];
  for (const name of names) {
    const spec = req[name] ?? opt[name];
    if (!spec || DYNAMIC.has(inputType(spec))) continue;
    rows.push({ name, type: inputType(spec), spec, value: isValueSpec(spec), required: name in req });
  }
  // Inputs the node carries that the server lists differently (autogrow "values.a", extension extras).
  for (const [name, v] of Object.entries(inputs)) {
    if (rows.some((r) => r.name === name)) continue;
    rows.push({ name, type: isLink(v) ? "*" : typeof v === "number" ? "FLOAT" : typeof v === "boolean" ? "BOOLEAN" : "STRING", value: !isLink(v), required: false });
  }
  return { outputs: def.output.map((type, i) => ({ type, name: def.output_name?.[i] ?? type })), inputs: rows };
}

/** Whether an output of type `got` may feed an input that takes `want`. */
export function canConnect(want: string, got: string): boolean {
  if (want === "*" || got === "*") return true;
  if (want === "ENUM") return got === "COMBO" || got === "*";
  return typesMatch(want, got);
}

/** The value a fresh node starts with for an input. */
export function defaultFor(spec: InputSpec): InputValue | undefined {
  const opts = (spec[1] ?? {}) as { default?: unknown; min?: number };
  const enumList = enumOptions(spec);
  if (enumList) return (opts.default as string) ?? enumList[0] ?? "";
  switch (inputType(spec)) {
    case "INT":
    case "FLOAT":
      return typeof opts.default === "number" ? opts.default : (opts.min ?? 0);
    case "STRING":
      return typeof opts.default === "string" ? opts.default : "";
    case "BOOLEAN":
      return typeof opts.default === "boolean" ? opts.default : false;
    default:
      return undefined;
  }
}

/** A node id not yet used: numbers continue after the highest one in the graph. */
export function nextId(graph: ApiGraph): string {
  let n = 0;
  for (const id of Object.keys(graph)) {
    const k = Number(id.split(":").pop());
    if (Number.isFinite(k)) n = Math.max(n, k);
  }
  let id = String(n + 1);
  while (graph[id]) id = String(Number(id) + 1);
  return id;
}

export function addNode(graph: ApiGraph, classType: string, info: ObjectInfo): { graph: ApiGraph; id: string } {
  const id = nextId(graph);
  const def = info[classType];
  const inputs: Record<string, InputValue> = {};
  for (const [name, spec] of Object.entries(def?.input.required ?? {})) {
    if (!isValueSpec(spec)) continue;
    const v = defaultFor(spec);
    if (v !== undefined) inputs[name] = v;
  }
  return { graph: { ...graph, [id]: { class_type: classType, inputs } }, id };
}

/** Remove nodes and every wire into them (the inputs they fed become empty). */
export function removeNodes(graph: ApiGraph, ids: string[]): ApiGraph {
  const gone = new Set(ids);
  const out: ApiGraph = {};
  for (const [id, node] of Object.entries(graph)) {
    if (gone.has(id)) continue;
    const inputs = Object.fromEntries(Object.entries(node.inputs).filter(([, v]) => !(isLink(v) && gone.has(v[0]))));
    out[id] = { ...node, inputs };
  }
  return out;
}

export function connect(graph: ApiGraph, from: Link, to: { node: string; input: string }): ApiGraph {
  const node = graph[to.node];
  if (!node || !graph[from[0]] || from[0] === to.node) return graph;
  return { ...graph, [to.node]: { ...node, inputs: { ...node.inputs, [to.input]: [from[0], from[1]] } } };
}

/** Unwire an input. A value input goes back to its default (or its old value kept in `restore`). */
export function disconnect(graph: ApiGraph, to: { node: string; input: string }, info: ObjectInfo): ApiGraph {
  const node = graph[to.node];
  if (!node) return graph;
  const inputs = { ...node.inputs };
  delete inputs[to.input];
  const def = info[node.class_type];
  const spec = def?.input.required?.[to.input] ?? def?.input.optional?.[to.input];
  if (spec && isValueSpec(spec) && to.input in (def?.input.required ?? {})) {
    const v = defaultFor(spec);
    if (v !== undefined) inputs[to.input] = v;
  }
  return { ...graph, [to.node]: { ...node, inputs } };
}

export function setValue(graph: ApiGraph, node: string, input: string, value: InputValue): ApiGraph {
  const n = graph[node];
  if (!n) return graph;
  return { ...graph, [node]: { ...n, inputs: { ...n.inputs, [input]: value } } };
}

export function setTitle(graph: ApiGraph, node: string, title: string): ApiGraph {
  const n = graph[node];
  if (!n) return graph;
  const meta = title.trim() ? { title: title.trim() } : undefined;
  return { ...graph, [node]: { ...n, ...(meta ? { _meta: meta } : { _meta: undefined }) } };
}

/** Copy nodes; wires between copied nodes follow the copies, wires from outside stay attached. */
export function duplicate(graph: ApiGraph, ids: string[]): { graph: ApiGraph; map: Record<string, string> } {
  let g = { ...graph };
  const map: Record<string, string> = {};
  for (const id of ids) {
    if (!g[id]) continue;
    const nid = nextId(g);
    map[id] = nid;
    g = { ...g, [nid]: structuredClone(g[id]) };
  }
  for (const nid of Object.values(map)) {
    const n = g[nid];
    for (const [k, v] of Object.entries(n.inputs)) if (isLink(v) && map[v[0]]) n.inputs[k] = [map[v[0]], v[1]];
  }
  return { graph: g, map };
}

/** Nodes that feed an output, so they will run. */
export const reachable = (graph: ApiGraph, info: ObjectInfo) => new Set(Object.keys(prune(graph, info)));

export const NODE_W = 280;
export const HEAD_H = 34;
export const ROW_H = 26;

/** Card height, from its rows (the editor and the layout agree on it). */
export const nodeHeight = (outputs: number, inputs: number) => HEAD_H + (outputs + inputs) * ROW_H + 8;

/**
 * Lay out a graph left to right: each node one column after the deepest node feeding it, columns
 * ordered so wires cross as little as a quick pass can manage.
 */
export function autoLayout(graph: ApiGraph, info: ObjectInfo): Layout {
  const ids = Object.keys(graph);
  const parents = new Map(ids.map((id) => [id, Object.values(graph[id].inputs).filter(isLink).map((l) => l[0]).filter((p) => graph[p])]));
  const depth = new Map<string, number>();
  const visit = (id: string, stack = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const d = Math.max(-1, ...parents.get(id)!.map((p) => visit(p, stack))) + 1;
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  ids.forEach((id) => visit(id));
  const cols = new Map<number, string[]>();
  for (const id of ids) cols.set(depth.get(id)!, [...(cols.get(depth.get(id)!) ?? []), id]);

  const layout: Layout = {};
  const height = (id: string) => {
    const r = rowsOf(graph[id].class_type, graph[id].inputs, info);
    return nodeHeight(r.outputs.length, r.inputs.length);
  };
  const GAP_X = NODE_W + 90;
  const GAP_Y = 36;
  for (const d of [...cols.keys()].sort((a, b) => a - b)) {
    const col = cols.get(d)!;
    // Order by where the parents sit (barycentre), so wires mostly run straight.
    const centre = (id: string) => {
      const ps = parents.get(id)!.filter((p) => layout[p]);
      return ps.length ? ps.reduce((s, p) => s + layout[p][1], 0) / ps.length : Number.MAX_SAFE_INTEGER / 2;
    };
    col.sort((a, b) => centre(a) - centre(b) || Number(a.split(":").pop()) - Number(b.split(":").pop()));
    let y = 0;
    for (const id of col) {
      layout[id] = [d * GAP_X, y];
      y += height(id) + GAP_Y;
    }
  }
  return layout;
}

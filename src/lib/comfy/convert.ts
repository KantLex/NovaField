// Turn a ComfyUI workflow into API format ("prompt" JSON), the shape /prompt accepts.
// Handles both files people have: API exports (passed through) and normal saved workflows
// (the canvas format), including subgraphs, bypassed and muted nodes, Reroute, Primitive
// and KJNodes Set/Get pairs. Widget values are mapped by the server's own input order.

import type { ApiGraph, InputValue } from "./graph";
import { inputType, type InputSpec, type NodeInfo, type ObjectInfo } from "./validate";
import { say } from "@/lib/say";

interface UiInput {
  name: string;
  type?: string;
  link: number | null;
  widget?: { name: string };
}
interface UiNode {
  id: number | string;
  type: string;
  mode?: number;
  title?: string;
  inputs?: UiInput[];
  outputs?: { name: string; type: string; links?: number[] | null }[];
  widgets_values?: unknown[] | Record<string, unknown>;
}
interface UiLink {
  id: number;
  origin_id: number | string;
  origin_slot: number;
  target_id: number | string;
  target_slot: number;
  type?: string;
}
interface Subgraph {
  id: string;
  name?: string;
  nodes: UiNode[];
  links: (UiLink | unknown[])[];
  inputs: { name: string; type: string; linkIds?: number[] }[];
  outputs: { name: string; type: string; linkIds?: number[] }[];
}
export interface UiWorkflow {
  nodes: UiNode[];
  links: (unknown[] | UiLink)[];
  definitions?: { subgraphs?: Subgraph[] };
}

export interface Converted {
  graph: ApiGraph;
  /** Titles the author gave nodes (API id → title), for labels. */
  titles: Record<string, string>;
  /** Node types the server does not have. */
  missing: string[];
  warnings: string[];
}

const VIRTUAL = new Set(["Note", "MarkdownNote", "Reroute", "PrimitiveNode", "SetNode", "GetNode", "Label (rgthree)", "Fast Groups Bypasser (rgthree)", "Fast Groups Muter (rgthree)", "Bookmark (rgthree)"]);
const CONTROL_VALUES = new Set(["fixed", "increment", "decrement", "randomize"]);
const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"]);

export const isApiFormat = (j: unknown): j is ApiGraph =>
  !!j && typeof j === "object" && !Array.isArray(j) && !("nodes" in j) && Object.values(j as object).every((n) => n && typeof n === "object" && "class_type" in n);

export const isUiFormat = (j: unknown): j is UiWorkflow => !!j && typeof j === "object" && Array.isArray((j as UiWorkflow).nodes) && Array.isArray((j as UiWorkflow).links);

const normLink = (l: UiLink | unknown[]): UiLink =>
  Array.isArray(l) ? { id: l[0] as number, origin_id: l[1] as number, origin_slot: l[2] as number, target_id: l[3] as number, target_slot: l[4] as number, type: l[5] as string } : (l as UiLink);

interface Scope {
  prefix: string;
  nodes: Map<string, UiNode>;
  links: Map<number, UiLink>;
  /** For a subgraph scope: the instance node in the parent and the parent scope. */
  instance?: UiNode;
  parent?: Scope;
  sub?: Subgraph;
}

type Source = { link: [string, number] } | { value: InputValue } | null;

type Inputs = { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };

/**
 * Read widget values positionally, in the server's input order. Seed widgets are followed by a
 * "control after generate" value and upload combos by an upload button value; both are skipped.
 * Dynamic combos store their chosen key, followed by that option's own widgets.
 */
function consumeWidgets(spec: Inputs, order: string[] | null, wv: unknown[], k: number, out: Record<string, InputValue>, prefix: string): number {
  const req = spec.required ?? {};
  const opt = spec.optional ?? {};
  const names = order ?? [...Object.keys(req), ...Object.keys(opt)];
  for (const name of names) {
    const s = req[name] ?? opt[name];
    if (!s || k >= wv.length) continue;
    const t = inputType(s);
    if (t === "COMFY_DYNAMICCOMBO_V3") {
      const v = wv[k++];
      out[prefix + name] = v as InputValue;
      const options = (s[1]?.options ?? []) as { key: string; inputs?: Inputs }[];
      const pick = options.find((o) => o.key === v);
      if (pick?.inputs) k = consumeWidgets(pick.inputs, null, wv, k, out, `${prefix}${name}.`);
      continue;
    }
    if (!(t === "ENUM" || WIDGET_TYPES.has(t)) || s[1]?.forceInput) continue;
    out[prefix + name] = wv[k++] as InputValue;
    const next = wv[k];
    if ((t === "INT" || t === "FLOAT" || s[1]?.control_after_generate) && typeof next === "string" && CONTROL_VALUES.has(next)) k++;
    else if ((s[1]?.image_upload || s[1]?.video_upload || s[1]?.audio_upload) && typeof next === "string" && ["image", "video", "audio"].includes(next)) k++;
  }
  return k;
}

export function uiToApi(wf: UiWorkflow, info: ObjectInfo): Converted {
  const graph: ApiGraph = {};
  const titles: Record<string, string> = {};
  const missing = new Set<string>();
  const warnings: string[] = [];
  const subgraphs = new Map((wf.definitions?.subgraphs ?? []).map((s) => [s.id, s]));

  const makeScope = (nodes: UiNode[], links: (UiLink | unknown[])[], prefix: string, extra: Partial<Scope> = {}): Scope => ({
    prefix,
    nodes: new Map(nodes.map((n) => [String(n.id), n])),
    links: new Map(links.map((l) => normLink(l)).map((l) => [l.id, l])),
    ...extra,
  });

  // Set/Get pairs are global by name.
  const setters = new Map<string, { scope: Scope; node: UiNode }>();
  const indexSetters = (scope: Scope) => {
    for (const n of scope.nodes.values()) if (n.type === "SetNode") setters.set(String(widgetArray(n)[0]), { scope, node: n });
  };

  const resolveLink = (scope: Scope, linkId: number | null | undefined, depth = 0): Source => {
    if (linkId == null || depth > 64) return null;
    const l = scope.links.get(linkId);
    if (!l) return null;
    return resolveOrigin(scope, String(l.origin_id), l.origin_slot, depth + 1);
  };

  const resolveOrigin = (scope: Scope, originId: string, slot: number, depth: number): Source => {
    // Subgraph input node: step out to the instance in the parent scope.
    if (originId === "-10" && scope.instance && scope.parent) {
      const name = scope.sub!.inputs[slot]?.name;
      const inp = scope.instance.inputs?.find((i) => i.name === name);
      if (inp?.link != null) return resolveLink(scope.parent, inp.link, depth);
      // A promoted widget: its value sits in the instance's widgets_values. Newer files list one value
      // per value-type subgraph input (in the subgraph's order) while the instance's own input list
      // may name only some of them; older files follow the instance's widget inputs. Use whichever
      // order accounts for every stored value.
      const wv = widgetArray(scope.instance);
      const bySub = scope.sub!.inputs.filter((i) => isValueType(i.type)).map((i) => i.name);
      const byInstance = (scope.instance.inputs ?? []).filter((i) => i.widget).map((i) => i.name);
      const order = bySub.length === wv.length ? bySub : byInstance.length === wv.length ? byInstance : bySub;
      const idx = order.indexOf(name ?? "");
      return idx >= 0 && idx < wv.length ? { value: wv[idx] as InputValue } : null;
    }
    const node = scope.nodes.get(originId);
    if (!node) return null;
    if (node.mode === 2) return null;
    if (node.type === "Reroute") return resolveLink(scope, node.inputs?.[0]?.link, depth);
    if (node.type === "PrimitiveNode") return { value: widgetArray(node)[0] as InputValue };
    if (node.type === "GetNode") {
      const set = setters.get(String(widgetArray(node)[0]));
      return set ? resolveLink(set.scope, set.node.inputs?.[0]?.link, depth) : null;
    }
    if (node.mode === 4) {
      // Bypassed: pass through the first input of the same type as this output.
      const type = node.outputs?.[slot]?.type;
      const through = node.inputs?.find((i) => i.type === type && i.link != null);
      return through ? resolveLink(scope, through.link, depth) : null;
    }
    const sub = subgraphs.get(node.type);
    if (sub) {
      const inner = innerScope(scope, node, sub);
      const linkId = sub.outputs[slot]?.linkIds?.[0];
      return resolveLink(inner, linkId, depth);
    }
    return { link: [scope.prefix + originId, slot] };
  };

  const innerScopes = new Map<string, Scope>();
  const innerScope = (parent: Scope, instance: UiNode, sub: Subgraph): Scope => {
    const key = parent.prefix + String(instance.id);
    let s = innerScopes.get(key);
    if (!s) {
      s = makeScope(sub.nodes, sub.links, `${key}:`, { instance, parent, sub });
      innerScopes.set(key, s);
      indexSetters(s);
    }
    return s;
  };

  const emit = (scope: Scope) => {
    for (const node of scope.nodes.values()) {
      if (node.mode === 2 || node.mode === 4 || VIRTUAL.has(node.type)) continue;
      const sub = subgraphs.get(node.type);
      if (sub) {
        emit(innerScope(scope, node, sub));
        continue;
      }
      const def = info[node.type];
      const id = scope.prefix + String(node.id);
      if (!def) {
        missing.add(node.type);
        continue;
      }
      const inputs: Record<string, InputValue> = {};
      const wv = node.widgets_values;
      const linked = new Map((node.inputs ?? []).map((i) => [i.widget?.name ?? i.name, i]));

      // Widgets, in the server's order; values come positionally (or by name for dict-style nodes).
      if (Array.isArray(wv)) {
        const order = (def as NodeInfo & { input_order?: { required?: string[]; optional?: string[] } }).input_order;
        consumeWidgets(def.input, order ? [...(order.required ?? []), ...(order.optional ?? [])] : null, wv, 0, inputs, "");
        for (const [k, v] of Object.entries(inputs)) if (v === undefined) delete inputs[k];
      } else if (wv && typeof wv === "object") {
        for (const [name, v] of Object.entries(wv)) if (name in (def.input.required ?? {}) || name in (def.input.optional ?? {})) inputs[name] = v as InputValue;
      }

      // Links override widget values (a widget converted to an input).
      for (const [name, inp] of linked) {
        if (inp.link == null) continue;
        const src = resolveLink(scope, inp.link);
        // Nothing upstream (a subgraph input left open, a muted source): keep the node's own value.
        if (!src) continue;
        inputs[name] = "link" in src ? src.link : src.value;
      }
      graph[id] = { class_type: node.type, inputs, ...(node.title ? { _meta: { title: node.title } } : {}) };
      if (node.title) titles[id] = node.title;
    }
  };

  const root = makeScope(wf.nodes, wf.links, "");
  indexSetters(root);
  for (const n of wf.nodes) {
    const sub = subgraphs.get(n.type);
    if (sub) indexSetters(innerScope(root, n, sub));
  }
  emit(root);

  // Drop links that point at nodes we skipped.
  for (const node of Object.values(graph)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && !graph[v[0] as string]) {
        delete node.inputs[k];
        warnings.push(`${node.class_type}.${k} was connected to a node that is muted or unknown.`);
      }
    }
  }
  return { graph, titles, missing: [...missing], warnings };
}

/** Types that are edited as a widget (number, text, toggle, list) rather than wired from another node. */
const isValueType = (t: unknown) => Array.isArray(t) || (typeof t === "string" && ["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"].includes(t));

function widgetArray(n: UiNode): unknown[] {
  return Array.isArray(n.widgets_values) ? n.widgets_values : n.widgets_values ? Object.values(n.widgets_values) : [];
}

/** Any workflow JSON → API format, or a readable reason it can't be used. */
export function toApi(json: unknown, info: ObjectInfo): Converted {
  if (isApiFormat(json)) {
    const graph = structuredClone(json);
    const missing = [...new Set(Object.values(graph).map((n) => n.class_type).filter((c) => !info[c]))];
    const titles: Record<string, string> = {};
    for (const [id, n] of Object.entries(graph)) if (n._meta?.title && n._meta.title !== info[n.class_type]?.display_name) titles[id] = n._meta.title;
    return { graph, titles, missing, warnings: [] };
  }
  if (isUiFormat(json)) return uiToApi(json, info);
  // Some tools wrap the API graph: { prompt: {...} } or { workflow: {...} }.
  const o = json as Record<string, unknown>;
  if (o && typeof o === "object") {
    if (o.prompt && isApiFormat(o.prompt)) return toApi(o.prompt, info);
    if (o.workflow && isUiFormat(o.workflow)) return uiToApi(o.workflow, info);
  }
  throw new Error(say("That file is not a ComfyUI workflow. Save it from ComfyUI (Workflow → Save or Export) and try again."));
}

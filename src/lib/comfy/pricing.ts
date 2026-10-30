// What a graph's API nodes cost per run. ComfyUI ships each paid node's price as a JSONata
// formula over its widget values (`price_badge` in object_info); this evaluates those formulas
// the way ComfyUI's own interface does, but with the values the graph will actually run with.

import jsonata from "jsonata";
import { isLink, type ApiGraph, type InputValue } from "./graph";
import type { GraphPrice, NodePrice } from "./credits";
import { prune, type ObjectInfo } from "./validate";

export type { GraphPrice, NodePrice } from "./credits";
export { formatCredits } from "./credits";

export interface PriceBadge {
  engine?: "jsonata";
  depends_on?: { widgets?: { name: string; type: string }[]; inputs?: string[]; input_groups?: string[] };
  expr: string;
}

type PricingResult =
  | { type: "usd"; usd: number; format?: Format }
  | { type: "range_usd"; min_usd: number; max_usd: number; format?: Format }
  | { type: "list_usd"; usd: number[]; format?: Format }
  | { type: "text"; text: string };

interface Format {
  approximate?: boolean;
  suffix?: string;
  note?: string;
  separator?: string;
}

const compiled = new Map<string, ReturnType<typeof jsonata>>();

type Specs = Record<string, unknown>;
type DynamicOption = { key: string; inputs?: { required?: Specs; optional?: Specs } };

function defaultOf(spec: unknown): unknown {
  if (!Array.isArray(spec)) return null;
  const [type, opts] = spec as [unknown, { default?: unknown; options?: unknown[] } | undefined];
  if (opts && "default" in opts) return opts.default;
  if (Array.isArray(type)) return type[0] ?? null;
  const first = opts?.options?.[0];
  // A dynamic choice ("model" with its own settings per model) lists options as {key, inputs}.
  return first && typeof first === "object" ? ((first as DynamicOption).key ?? null) : (first ?? null);
}

/**
 * A widget's value in this node: as set in the graph, else its default. "model.resolution" is a
 * setting of the chosen model, so its default comes from that model's own settings.
 */
function widgetValue(name: string, inputs: Record<string, InputValue>, specs: Specs): unknown {
  // A widget fed by another node (["12", 0]) has no value until it runs: unpriceable, not "12,0".
  if (name in inputs) return isLink(inputs[name]) ? null : inputs[name];
  const dot = name.indexOf(".");
  if (dot < 0) return defaultOf(specs[name]);
  const parent = name.slice(0, dot);
  const options = ((specs[parent] as [unknown, { options?: DynamicOption[] }] | undefined)?.[1]?.options ?? []).filter((o) => o && typeof o === "object");
  const chosen = String(widgetValue(parent, inputs, specs) ?? "");
  const option = options.find((o) => o.key === chosen) ?? options[0];
  return option ? widgetValue(name.slice(dot + 1), {}, { ...option.inputs?.required, ...option.inputs?.optional }) : null;
}

/** Same normalising as ComfyUI: numbers as numbers, choices lower-cased. */
function normalize(v: unknown, type: string): unknown {
  if (v == null) return null;
  const t = type.toUpperCase();
  if (t === "INT" || t === "FLOAT") {
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (t === "BOOLEAN") return typeof v === "boolean" ? v : String(v).trim().toLowerCase() === "true";
  if (t === "COMBO" && (typeof v === "number" || typeof v === "boolean")) return v;
  return String(v).trim().toLowerCase();
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toPrice(r: unknown): Omit<NodePrice, "node" | "classType"> | null {
  if (!r || typeof r !== "object") return null;
  const res = r as PricingResult;
  const f = "format" in res ? (res.format ?? {}) : {};
  const per = f.suffix && !/^\s*\/\s*run\s*$/i.test(f.suffix) ? f.suffix.trim() : null;
  const base = { approximate: !!f.approximate || !!per, per, text: null };
  if (res.type === "usd") return num(res.usd) == null ? null : { ...base, minUsd: res.usd, maxUsd: res.usd };
  if (res.type === "range_usd") {
    const [lo, hi] = [num(res.min_usd), num(res.max_usd)];
    return lo == null || hi == null ? null : { ...base, minUsd: lo, maxUsd: hi, approximate: base.approximate || lo !== hi };
  }
  if (res.type === "list_usd") {
    const xs = (Array.isArray(res.usd) ? res.usd : []).map(num).filter((x): x is number => x != null);
    return xs.length ? { ...base, minUsd: Math.min(...xs), maxUsd: Math.max(...xs), approximate: base.approximate || xs.length > 1 } : null;
  }
  if (res.type === "text") return { minUsd: null, maxUsd: null, approximate: true, per: null, text: String(res.text) };
  return null;
}

/** The price of each API node the graph runs, summed. Null when it runs no API node. */
export async function priceGraph(graph: ApiGraph, info: ObjectInfo): Promise<GraphPrice | null> {
  const nodes: NodePrice[] = [];
  for (const [id, node] of Object.entries(prune(graph, info))) {
    const def = info[node.class_type] as (ObjectInfo[string] & { price_badge?: PriceBadge }) | undefined;
    if (!def?.api_node) continue;
    const badge = def.price_badge;
    const unknown: NodePrice = { node: id, classType: node.class_type, minUsd: null, maxUsd: null, approximate: true, per: null, text: null };
    if (!badge?.expr || (badge.engine && badge.engine !== "jsonata")) {
      nodes.push(unknown);
      continue;
    }
    const specs = { ...def.input.required, ...def.input.optional } as Specs;
    const widgets: Record<string, unknown> = {};
    for (const w of badge.depends_on?.widgets ?? []) widgets[w.name] = normalize(widgetValue(w.name, node.inputs, specs), w.type);
    const inputs: Record<string, { connected: boolean }> = {};
    for (const name of badge.depends_on?.inputs ?? []) inputs[name] = { connected: isLink(node.inputs[name]) };
    // Grouped inputs ("model.images") arrive as numbered entries; count the connected ones.
    const inputGroups: Record<string, number> = {};
    for (const g of badge.depends_on?.input_groups ?? []) {
      inputGroups[g] = Object.entries(node.inputs).filter(([k, v]) => k.startsWith(`${g}.`) && isLink(v)).length;
    }
    try {
      let expr = compiled.get(badge.expr);
      if (!expr) compiled.set(badge.expr, (expr = jsonata(badge.expr)));
      const price = Object.values(widgets).some((v) => v === null) ? null : toPrice(await expr.evaluate({ widgets, inputs, inputGroups }));
      nodes.push(price ? { node: id, classType: node.class_type, ...price } : unknown);
    } catch {
      nodes.push(unknown);
    }
  }
  if (!nodes.length) return null;
  return {
    minUsd: nodes.reduce((s, n) => s + (n.minUsd ?? 0), 0),
    maxUsd: nodes.reduce((s, n) => s + (n.maxUsd ?? 0), 0),
    approximate: nodes.some((n) => n.approximate),
    nodes,
  };
}

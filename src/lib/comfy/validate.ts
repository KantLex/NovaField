// Preflight: check a compiled graph against the server's live /object_info before queueing,
// so a typo or a missing model becomes a readable message instead of a failed render.

import { type ApiGraph, isLink } from "./graph";
import { say } from "@/lib/say";

export type InputSpec = [unknown, Record<string, unknown>?];
export interface NodeInfo {
  input: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> };
  output: string[];
  output_name?: string[];
  display_name?: string;
  output_node?: boolean;
  /** ComfyUI partner/API node: runs on a paid cloud service billed to the Comfy account. */
  api_node?: boolean;
  category?: string;
  description?: string;
  deprecated?: boolean;
}

/** API node types a graph would run (only those that feed an output). */
export const apiNodes = (graph: ApiGraph, info: ObjectInfo) => [...new Set(Object.values(prune(graph, info)).map((n) => n.class_type).filter((c) => info[c]?.api_node))];

const OUTPUT_FALLBACK = new Set(["SaveVideo", "SaveImage", "PreviewImage", "SaveAudio"]);
export const isOutputNode = (classType: string, info: ObjectInfo) => info[classType]?.output_node ?? OUTPUT_FALLBACK.has(classType);

/**
 * Only nodes that feed an output run; ComfyUI ignores the rest. Returns the graph without
 * dangling nodes, so a stray unconnected node never blocks a render.
 */
export function prune(graph: ApiGraph, info: ObjectInfo): ApiGraph {
  const keep = new Set<string>();
  const stack = Object.entries(graph)
    .filter(([, n]) => isOutputNode(n.class_type, info))
    .map(([id]) => id);
  while (stack.length) {
    const id = stack.pop()!;
    if (keep.has(id) || !graph[id]) continue;
    keep.add(id);
    for (const v of Object.values(graph[id].inputs)) if (isLink(v)) stack.push(v[0]);
  }
  return Object.fromEntries(Object.entries(graph).filter(([id]) => keep.has(id)));
}
export type ObjectInfo = Record<string, NodeInfo>;

export interface Issue {
  node: string;
  classType: string;
  input?: string;
  message: string;
  /** Warnings are shown but never stop a render. */
  level?: "error" | "warning";
}

export const errorsOf = (issues: Issue[]) => issues.filter((i) => i.level !== "warning");
export const warningsOf = (issues: Issue[]) => issues.filter((i) => i.level === "warning");

/** Enum options of an input spec, or null when the input is not an enum. */
export function enumOptions(spec: InputSpec | undefined): string[] | null {
  if (!spec) return null;
  const [t, opts] = spec;
  if (Array.isArray(t)) return t.map(String);
  if (t === "COMBO" && Array.isArray(opts?.options)) return (opts.options as unknown[]).map(String);
  return null;
}

/** Type name an input expects (IMAGE, MODEL, INT, ...), or "ENUM". */
export function inputType(spec: InputSpec): string {
  const [t] = spec;
  if (Array.isArray(t)) return "ENUM";
  return String(t);
}

const DYNAMIC = new Set(["COMFY_AUTOGROW_V3", "COMFY_DYNAMICCOMBO_V3"]);
const PRIMITIVE = new Set(["INT", "FLOAT", "STRING", "BOOLEAN"]);

export function validateGraph(full: ApiGraph, info: ObjectInfo): Issue[] {
  const issues: Issue[] = [];
  let hasOutput = false;
  const graph = prune(full, info);

  for (const [id, node] of Object.entries(graph)) {
    const def = info[node.class_type];
    if (!def) {
      issues.push({
        node: id,
        classType: node.class_type,
        message: say("The server has no node called {node}. Install the pack that provides it, or restart ComfyUI.", { node: node.class_type }),
      });
      continue;
    }
    if (isOutputNode(node.class_type, info)) hasOutput = true;

    const required = def.input.required ?? {};
    const optional = def.input.optional ?? {};

    for (const [name, spec] of Object.entries(required)) {
      if (DYNAMIC.has(inputType(spec))) continue;
      if (!(name in node.inputs)) {
        issues.push({ node: id, classType: node.class_type, input: name, message: `Missing required input "${name}".` });
      }
    }

    for (const [name, value] of Object.entries(node.inputs)) {
      // Dotted names belong to autogrow / dynamic-combo inputs (ref_images.ref_image_0, format.codec).
      const root = name.split(".")[0];
      const spec = required[name] ?? optional[name] ?? required[root] ?? optional[root];
      if (!spec) {
        // Browser extensions add inputs the server never declared (image_3, image_4… on batch
        // nodes). ComfyUI passes them through to nodes that accept them, so this only warns.
        issues.push({
          node: id,
          classType: node.class_type,
          input: name,
          level: "warning",
          message: `"${name}" isn't declared by the node; it was probably added by the node's browser extension. ComfyUI will pass it through.`,
        });
        continue;
      }
      if (name.includes(".") || DYNAMIC.has(inputType(spec))) continue;

      if (isLink(value)) {
        const src = graph[value[0]];
        if (!src) {
          issues.push({ node: id, classType: node.class_type, input: name, message: say("Links to node {node}, which does not exist.", { node: value[0] }) });
          continue;
        }
        const srcDef = info[src.class_type];
        const outType = srcDef?.output?.[value[1]];
        const want = inputType(spec);
        if (srcDef && !outType) {
          issues.push({ node: id, classType: node.class_type, input: name, message: `${src.class_type} has no output #${value[1]}.` });
        } else if (outType && want !== "ENUM" && want !== "*" && outType !== "*" && !typesMatch(want, outType)) {
          issues.push({
            node: id,
            classType: node.class_type,
            input: name,
            message: say("Expects {want}, but {node} gives {got}.", { want, node: src.class_type, got: outType }),
          });
        }
        continue;
      }

      const options = enumOptions(spec);
      // Upload widgets (LoadImage, LoadVideo, LoadAudio) list the input folder as it was when
      // /object_info was read; files uploaded since are valid, and ComfyUI checks them on queue.
      const uploadable = !!(spec[1]?.image_upload || spec[1]?.video_upload || spec[1]?.audio_upload);
      if (options && !uploadable && value !== null && !options.includes(String(value))) {
        issues.push({
          node: id,
          classType: node.class_type,
          input: name,
          message: `"${value}" is not available on the server (${options.length ? `options: ${options.slice(0, 6).join(", ")}${options.length > 6 ? "…" : ""}` : "no files of this kind installed"}).`,
        });
        continue;
      }
      const t = inputType(spec);
      if (PRIMITIVE.has(t)) {
        const ok =
          (t === "INT" && Number.isInteger(value)) ||
          (t === "FLOAT" && typeof value === "number") ||
          (t === "STRING" && typeof value === "string") ||
          (t === "BOOLEAN" && typeof value === "boolean");
        if (!ok) issues.push({ node: id, classType: node.class_type, input: name, message: say("Expects {want}, got {got}.", { want: t, got: JSON.stringify(value) }) });
        const opts = spec[1] ?? {};
        if (typeof value === "number") {
          if (typeof opts.min === "number" && value < opts.min)
            issues.push({ node: id, classType: node.class_type, input: name, message: `${value} is below the minimum ${opts.min}.` });
          if (typeof opts.max === "number" && value > opts.max)
            issues.push({ node: id, classType: node.class_type, input: name, message: `${value} is above the maximum ${opts.max}.` });
        }
      }
    }
  }

  if (!hasOutput) issues.push({ node: "-", classType: "-", message: say("The graph has no output node, so ComfyUI would refuse it.") });
  return issues;
}

export function typesMatch(want: string, got: string) {
  if (want === got) return true;
  // Template types (switches, match-type nodes) adapt to whatever they are wired to.
  if (want.startsWith("COMFY_") || got.startsWith("COMFY_")) return true;
  // Comma-separated unions like "IMAGE,MASK".
  return want.split(",").includes(got) || got.split(",").includes(want);
}

// A tiny builder for ComfyUI API-format graphs ("prompt" JSON).
// Engines describe intent in TypeScript; the builder hands out stable node ids and typed links.

export type Link = [string, number];
export type InputValue = string | number | boolean | Link | null;

export interface ApiNode {
  class_type: string;
  inputs: Record<string, InputValue>;
  _meta?: { title: string };
}

export type ApiGraph = Record<string, ApiNode>;

export class NodeRef {
  constructor(
    readonly id: string,
    readonly classType: string,
  ) {}
  out(index = 0): Link {
    return [this.id, index];
  }
}

export function isLink(v: unknown): v is Link {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
}

export class Graph {
  private nodes: ApiGraph = {};
  private next = 1;

  add(classType: string, inputs: Record<string, InputValue | undefined>, title?: string): NodeRef {
    const id = String(this.next++);
    const clean: Record<string, InputValue> = {};
    for (const [k, v] of Object.entries(inputs)) if (v !== undefined) clean[k] = v;
    this.nodes[id] = { class_type: classType, inputs: clean, ...(title ? { _meta: { title } } : {}) };
    return new NodeRef(id, classType);
  }

  /** Set or replace one input on an existing node (for wiring decided later). */
  set(node: NodeRef, input: string, value: InputValue) {
    this.nodes[node.id].inputs[input] = value;
  }

  toJSON(): ApiGraph {
    return structuredClone(this.nodes);
  }
}

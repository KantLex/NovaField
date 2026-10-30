import type { ApiGraph, InputValue } from "../comfy/graph";

export type FieldKind = "text" | "image" | "video" | "audio" | "seed" | "number" | "toggle" | "choice";

/** What a field means, so Studio can drive any workflow with its director's panel. */
export type Role = "prompt" | "negative" | "image" | "video" | "audio" | "seed" | "width" | "height" | "aspect" | "frames" | "seconds" | "steps" | "none";

export interface Field {
  /** `${node}.${input}`: unique within a recipe. */
  id: string;
  node: string;
  input: string;
  kind: FieldKind;
  role: Role;
  label: string;
  /** The node it belongs to, as the author named it. */
  group: string;
  value: InputValue;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  multiline?: boolean;
  /** Shown on the form. */
  exposed: boolean;
  /** Tucked under "More settings". */
  advanced: boolean;
  /** Seeds: draw a new one every run. */
  randomize?: boolean;
}

export type OutputKind = "video" | "image" | "audio" | "unknown";

/** A ComfyUI workflow turned into a NovaField app. */
export interface Recipe {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  graph: ApiGraph;
  fields: Field[];
  output: OutputKind;
  /** Frame rate the workflow writes, when it says so (for turning seconds into frames). */
  fps: number | null;
  /** Node types the server lacks; the recipe can't run until they're installed. */
  missing: string[];
  warnings: string[];
  /** ComfyUI API nodes it uses: paid cloud services billed to the Comfy account. */
  paid?: string[];
  /** The file as imported, so it can be read again after missing packs are installed. */
  original?: unknown;
  /** Node positions from graph mode (API graphs carry none). */
  layout?: Record<string, [number, number]>;
  /** When it was last edited in graph mode. */
  editedAt?: number;
}

export type RecipeSummary = Omit<Recipe, "graph" | "original">;

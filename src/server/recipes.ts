// Workflow apps ("recipes") saved as data/workflows/<id>.json.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { toApi } from "@/lib/comfy/convert";
import type { ApiGraph } from "@/lib/comfy/graph";
import { apiNodes, prune } from "@/lib/comfy/validate";
import { detectFields, detectFps, detectOutput } from "@/lib/workflows/detect";
import type { Recipe, RecipeSummary } from "@/lib/workflows/types";
import { objectInfo } from "./comfy";
import { DATA_DIR } from "./config";
import { writeJson } from "./jsonFile";
import { say } from "@/lib/say";

const DIR = path.join(DATA_DIR, "workflows");
const file = (id: string) => path.join(DIR, `${id.replace(/[^\w-]/g, "")}.json`);

export async function listRecipes(): Promise<RecipeSummary[]> {
  await mkdir(DIR, { recursive: true });
  const out: RecipeSummary[] = [];
  for (const f of await readdir(DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { graph, original, ...summary } = JSON.parse(await readFile(path.join(DIR, f), "utf8")) as Recipe;
      out.push(summary);
    } catch {
      /* skip a damaged file */
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  try {
    return JSON.parse(await readFile(file(id), "utf8")) as Recipe;
  } catch {
    return null;
  }
}

export async function saveRecipe(r: Recipe) {
  await mkdir(DIR, { recursive: true });
  r.updatedAt = Date.now();
  await writeJson(file(r.id), r);
  return r;
}

export const deleteRecipe = (id: string) => rm(file(id), { force: true });

/** Read any workflow JSON into a recipe, using the live server to understand its nodes. */
export async function importRecipe(json: unknown, source: string): Promise<Recipe> {
  const name = source
    .replace(/\.json$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const now = Date.now();
  return saveRecipe({ ...(await read(json)), id: randomUUID().slice(0, 8), name: name || "Untitled workflow", source, createdAt: now, updatedAt: now, original: json });
}

/**
 * Read the original file again (after installing packs, say). The form keeps its edits for
 * every field that still exists.
 */
export async function recheckRecipe(id: string): Promise<Recipe> {
  const r = await getRecipe(id);
  if (!r) throw new Error(say("No such workflow."));
  if (r.original === undefined) throw new Error(say("This workflow was imported before NovaField kept the original file. Remove it and import the .json again."));
  return saveRecipe({ ...r, ...(await rebuild(r, r.original, true)) });
}

/** Read a graph again, keeping how the form presents each field that still exists (and, optionally, its value). */
async function rebuild(r: Recipe, json: unknown, keepValues: boolean) {
  const fresh = await read(json);
  const old = new Map(r.fields.map((f) => [f.id, f]));
  fresh.fields = fresh.fields.map((f) => {
    const o = old.get(f.id);
    return o ? { ...f, label: o.label, exposed: o.exposed, advanced: o.advanced, role: o.role, randomize: o.randomize, ...(keepValues ? { value: o.value } : {}) } : f;
  });
  return fresh;
}

/**
 * The graph to edit in graph mode: every node (not just those feeding an output) in API format.
 * After the first edit, the edited graph is what the workflow is.
 */
export async function editableGraph(r: Recipe): Promise<ApiGraph> {
  if (r.original === undefined) return r.graph;
  try {
    return toApi(r.original, await objectInfo()).graph;
  } catch {
    return r.graph;
  }
}

/** Save a graph-mode edit: it becomes the workflow, and the form is read from it again. */
export async function saveGraph(id: string, graph: ApiGraph, layout: Recipe["layout"]): Promise<Recipe> {
  const r = await getRecipe(id);
  if (!r) throw new Error(say("No such workflow."));
  if (!graph || typeof graph !== "object" || !Object.keys(graph).length) throw new Error(say("The graph is empty."));
  // Values come from the edited graph (that's the point of editing it); presentation is kept.
  const fresh = await rebuild(r, graph, false);
  return saveRecipe({ ...r, ...fresh, original: graph, layout, editedAt: Date.now() });
}

async function read(json: unknown): Promise<Omit<Recipe, "id" | "name" | "source" | "createdAt" | "updatedAt" | "original">> {
  let info;
  try {
    info = await objectInfo(true);
  } catch {
    throw new Error(say("ComfyUI is offline. NovaField needs the server's node list to read a workflow."));
  }
  const converted = toApi(json, info);
  const graph = prune(converted.graph, info);
  if (!Object.keys(graph).length && !converted.missing.length) throw new Error(say("This workflow has no output node (Save Image, Save Video…), so there is nothing to run."));
  return {
    graph: converted.missing.length ? converted.graph : graph,
    fields: detectFields(converted.graph, info, converted.titles),
    output: detectOutput(graph, info),
    fps: detectFps(graph),
    missing: converted.missing,
    warnings: converted.warnings,
    paid: apiNodes(graph, info),
  };
}

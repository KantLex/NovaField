import { describe, expect, it } from "vitest";
import serverInfo from "../../test/fixtures/object_info.min.json";
import { addNode, autoLayout, canConnect, connect, disconnect, duplicate, nextId, reachable, removeNodes, rowsOf } from "./edit";
import type { ApiGraph } from "./graph";
import { validateGraph, type ObjectInfo } from "./validate";

const info = serverInfo as unknown as ObjectInfo;

// UNET → KSampler ← two prompts; KSampler → VAEDecode → SaveImage.
const base: ApiGraph = {
  "1": { class_type: "UNETLoader", inputs: { unet_name: "flux1-krea-dev.safetensors", weight_dtype: "default" } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "a fox", clip: ["2", 0] } },
  "6": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["3", 0], seed: 1, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["9", 0] } },
  "9": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
  "10": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "fox" } },
};

describe("graph mode", () => {
  it("shows a node's outputs and inputs in the server's order, values as values", () => {
    const r = rowsOf("KSampler", base["6"].inputs, info);
    expect(r.outputs).toEqual([{ name: "LATENT", type: "LATENT" }]);
    expect(r.inputs.map((x) => x.name).slice(0, 4)).toEqual(["model", "seed", "steps", "cfg"]);
    expect(r.inputs.find((x) => x.name === "model")?.value).toBe(false);
    expect(r.inputs.find((x) => x.name === "sampler_name")).toMatchObject({ value: true, type: "ENUM" });
  });

  it("only wires matching types", () => {
    expect(canConnect("MODEL", "MODEL")).toBe(true);
    expect(canConnect("MODEL", "IMAGE")).toBe(false);
    expect(canConnect("IMAGE,MASK", "MASK")).toBe(true);
    expect(canConnect("*", "LATENT")).toBe(true);
  });

  it("adds a node with the server's defaults and a fresh id", () => {
    expect(nextId(base)).toBe("11");
    const { graph, id } = addNode(base, "KSampler", info);
    expect(id).toBe("11");
    expect(graph[id].inputs.steps).toBeTypeOf("number");
    expect(graph[id].inputs.sampler_name).toBeTypeOf("string");
    expect(graph[id].inputs.model).toBeUndefined();
  });

  it("removing a node unwires what it fed, and validation notices", () => {
    const g = removeNodes(base, ["9"]);
    expect(g["9"]).toBeUndefined();
    expect(g["8"].inputs.vae).toBeUndefined();
    expect(validateGraph(g, info).some((i) => i.node === "8" && i.input === "vae")).toBe(true);
  });

  it("connects, refuses self-loops, and disconnecting a value input restores a default", () => {
    const g = connect(base, ["9", 0], { node: "8", input: "vae" });
    expect(g["8"].inputs.vae).toEqual(["9", 0]);
    expect(connect(base, ["6", 0], { node: "6", input: "model" })).toBe(base);
    const prim: ApiGraph = { ...base, "20": { class_type: "UNETLoader", inputs: { unet_name: "x", weight_dtype: "default" } } };
    const wired = { ...prim, "6": { ...prim["6"], inputs: { ...prim["6"].inputs, steps: ["20", 0] as [string, number] } } };
    expect(typeof disconnect(wired, { node: "6", input: "steps" }, info)["6"].inputs.steps).toBe("number");
  });

  it("duplicates keep wires between copies and to the outside", () => {
    const { graph, map } = duplicate(base, ["6", "8"]);
    expect(graph[map["8"]].inputs.samples).toEqual([map["6"], 0]);
    expect(graph[map["6"]].inputs.model).toEqual(["1", 0]);
  });

  it("lays out left to right by depth, without overlaps in a column", () => {
    const layout = autoLayout(base, info);
    expect(layout["1"][0]).toBeLessThan(layout["6"][0]);
    expect(layout["6"][0]).toBeLessThan(layout["8"][0]);
    expect(layout["8"][0]).toBeLessThan(layout["10"][0]);
    expect(layout["1"][1]).not.toBe(layout["9"][1]);
  });

  it("knows which nodes run", () => {
    const g = { ...base, "30": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } } };
    const r = reachable(g, info);
    expect(r.has("10")).toBe(true);
    expect(r.has("30")).toBe(false);
  });
});

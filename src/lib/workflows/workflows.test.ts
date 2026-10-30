import { describe, expect, it } from "vitest";
import serverInfo from "../../test/fixtures/object_info.min.json";
import { toApi } from "../comfy/convert";
import { apiNodes, errorsOf, validateGraph, warningsOf, type ObjectInfo } from "../comfy/validate";
import { compile } from "../engines";
import { NO_CAPABILITIES } from "../engines/capabilities";
import type { ShotSpec } from "../engines/specs";
import { applyValues, fillForShot, isEngine, SIZE_RATIOS, sizeFor } from "./apply";
import { detectFields, detectOutput } from "./detect";
import type { Field, Recipe, Role } from "./types";

const info = serverInfo as unknown as ObjectInfo;

// A canvas-format workflow with the awkward bits people's files have.
const canvas = {
  nodes: [
    { id: 1, type: "UNETLoader", mode: 0, inputs: [], widgets_values: ["flux1-krea-dev.safetensors", "default"] },
    { id: 2, type: "DualCLIPLoader", mode: 0, inputs: [], widgets_values: ["clip_l.safetensors", "t5xxl_fp16.safetensors", "flux", "default"] },
    { id: 3, type: "CLIPTextEncode", mode: 0, title: "Positive", inputs: [{ name: "clip", link: 10 }], widgets_values: ["a red fox in snow"] },
    { id: 4, type: "CLIPTextEncode", mode: 0, inputs: [{ name: "clip", link: 11 }], widgets_values: ["blurry, low quality"] },
    { id: 5, type: "EmptySD3LatentImage", mode: 0, inputs: [], widgets_values: [1024, 1024, 1] },
    {
      id: 6,
      type: "KSampler",
      mode: 0,
      inputs: [
        { name: "model", link: 12 },
        { name: "positive", link: 13 },
        { name: "negative", link: 14 },
        { name: "latent_image", link: 15 },
        { name: "steps", widget: { name: "steps" }, link: 16 },
      ],
      widgets_values: [42, "randomize", 20, 1, "euler", "simple", 1],
    },
    { id: 7, type: "Reroute", mode: 0, inputs: [{ name: "", link: 20 }], outputs: [{ name: "", type: "CONDITIONING", links: [13] }] },
    { id: 8, type: "PrimitiveNode", mode: 0, inputs: [], outputs: [{ name: "INT", type: "INT", links: [16] }], widgets_values: [12, "fixed"] },
    { id: 9, type: "VAELoader", mode: 0, inputs: [], widgets_values: ["ae.safetensors"] },
    { id: 10, type: "VAEDecode", mode: 0, inputs: [{ name: "samples", link: 17 }, { name: "vae", link: 18 }] },
    // Bypassed: its IMAGE input passes straight through to the save node.
    { id: 12, type: "VAEDecodeTiled", mode: 4, inputs: [{ name: "samples", link: 21 }, { name: "vae", link: 22 }, { name: "image", type: "IMAGE", link: 23 }], outputs: [{ name: "IMAGE", type: "IMAGE", links: [19] }], widgets_values: [512, 64, 64, 8] },
    { id: 11, type: "SaveImage", mode: 0, inputs: [{ name: "images", link: 19 }], widgets_values: ["fox"] },
    { id: 13, type: "MarkdownNote", mode: 0, inputs: [], widgets_values: ["Read me"] },
  ],
  links: [
    [10, 2, 0, 3, 0, "CLIP"],
    [11, 2, 0, 4, 0, "CLIP"],
    [12, 1, 0, 6, 0, "MODEL"],
    [20, 3, 0, 7, 0, "CONDITIONING"],
    [13, 7, 0, 6, 1, "CONDITIONING"],
    [14, 4, 0, 6, 2, "CONDITIONING"],
    [15, 5, 0, 6, 3, "LATENT"],
    [16, 8, 0, 6, 4, "INT"],
    [17, 6, 0, 10, 0, "LATENT"],
    [18, 9, 0, 10, 1, "VAE"],
    [23, 10, 0, 12, 2, "IMAGE"],
    [19, 12, 0, 11, 0, "IMAGE"],
  ],
};

// A subgraph wrapping the text encoder, with its text promoted to the outside.
const withSubgraph = {
  nodes: [
    { id: 21, type: "DualCLIPLoader", mode: 0, inputs: [], widgets_values: ["clip_l.safetensors", "t5xxl_fp16.safetensors", "flux", "default"] },
    {
      id: 20,
      type: "sg-1",
      mode: 0,
      inputs: [
        { name: "clip", type: "CLIP", link: 31 },
        { name: "text", type: "STRING", widget: { name: "text" }, link: null },
      ],
      outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: [30, 32] }],
      widgets_values: ["a cat on a windowsill"],
    },
    { id: 22, type: "UNETLoader", mode: 0, inputs: [], widgets_values: ["flux1-krea-dev.safetensors", "default"] },
    { id: 23, type: "EmptySD3LatentImage", mode: 0, inputs: [], widgets_values: [768, 768, 1] },
    {
      id: 24,
      type: "KSampler",
      mode: 0,
      inputs: [
        { name: "model", link: 33 },
        { name: "positive", link: 30 },
        { name: "negative", link: 32 },
        { name: "latent_image", link: 34 },
      ],
      widgets_values: [7, "fixed", 8, 1, "euler", "simple", 1],
    },
    { id: 25, type: "VAELoader", mode: 0, inputs: [], widgets_values: ["ae.safetensors"] },
    { id: 26, type: "VAEDecode", mode: 0, inputs: [{ name: "samples", link: 35 }, { name: "vae", link: 36 }] },
    { id: 27, type: "SaveImage", mode: 0, inputs: [{ name: "images", link: 37 }], widgets_values: ["cat"] },
  ],
  links: [
    [31, 21, 0, 20, 0, "CLIP"],
    [30, 20, 0, 24, 1, "CONDITIONING"],
    [32, 20, 0, 24, 2, "CONDITIONING"],
    [33, 22, 0, 24, 0, "MODEL"],
    [34, 23, 0, 24, 3, "LATENT"],
    [35, 24, 0, 26, 0, "LATENT"],
    [36, 25, 0, 26, 1, "VAE"],
    [37, 26, 0, 27, 0, "IMAGE"],
  ],
  definitions: {
    subgraphs: [
      {
        id: "sg-1",
        name: "Encode",
        inputs: [
          { name: "clip", type: "CLIP", linkIds: [101] },
          { name: "text", type: "STRING", linkIds: [102] },
        ],
        outputs: [{ name: "CONDITIONING", type: "CONDITIONING", linkIds: [103] }],
        nodes: [{ id: 1, type: "CLIPTextEncode", mode: 0, inputs: [{ name: "clip", link: 101 }, { name: "text", widget: { name: "text" }, link: 102 }], widgets_values: ["placeholder"] }],
        links: [
          { id: 101, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: "CLIP" },
          { id: 102, origin_id: -10, origin_slot: 1, target_id: 1, target_slot: 1, type: "STRING" },
          { id: 103, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: "CONDITIONING" },
        ],
      },
    ],
  },
};

describe("workflow conversion", () => {
  it("maps canvas widgets by the server's input order and resolves virtual nodes", () => {
    const { graph, missing } = toApi(canvas, info);
    expect(missing).toEqual([]);
    const ks = graph["6"].inputs;
    expect(ks.seed).toBe(42); // the "randomize" value after the seed is skipped
    expect(ks.steps).toBe(12); // from the Primitive node
    expect(ks.cfg).toBe(1);
    expect(ks.sampler_name).toBe("euler");
    expect(ks.positive).toEqual(["3", 0]); // through the Reroute
    expect(graph["11"].inputs.images).toEqual(["10", 0]); // around the bypassed node
    for (const gone of ["7", "8", "12", "13"]) expect(graph[gone]).toBeUndefined();
    expect(validateGraph(graph, info)).toEqual([]);
  });

  it("flattens subgraphs with promoted widgets", () => {
    const { graph } = toApi(withSubgraph, info);
    expect(graph["20:1"].class_type).toBe("CLIPTextEncode");
    expect(graph["20:1"].inputs.text).toBe("a cat on a windowsill");
    expect(graph["20:1"].inputs.clip).toEqual(["21", 0]);
    expect(graph["24"].inputs.positive).toEqual(["20:1", 0]);
    expect(validateGraph(graph, info)).toEqual([]);
  });

  it("reads promoted values in the subgraph's input order when the instance lists only some inputs", () => {
    // Newer ComfyUI files (the official templates): one stored value per value-type subgraph input,
    // while the instance's own input list skips the ones never wired from outside.
    const wf = {
      nodes: [
        {
          id: 40,
          type: "sg-2",
          mode: 0,
          inputs: [
            { name: "clip", type: "CLIP", link: null },
            { name: "vae_name", type: "COMBO", widget: { name: "vae_name" }, link: null },
          ],
          outputs: [],
          widgets_values: ["a lighthouse at dusk", "ae.safetensors"],
        },
      ],
      links: [],
      definitions: {
        subgraphs: [
          {
            id: "sg-2",
            inputs: [
              { name: "clip", type: "CLIP", linkIds: [201] },
              { name: "text", type: "STRING", linkIds: [202] },
              { name: "vae_name", type: "COMBO", linkIds: [203] },
            ],
            outputs: [],
            nodes: [
              { id: 1, type: "CLIPTextEncode", mode: 0, inputs: [{ name: "clip", link: 201 }, { name: "text", widget: { name: "text" }, link: 202 }], widgets_values: ["placeholder"] },
              { id: 2, type: "VAELoader", mode: 0, inputs: [{ name: "vae_name", widget: { name: "vae_name" }, link: 203 }], widgets_values: ["other.safetensors"] },
            ],
            links: [
              { id: 201, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: "CLIP" },
              { id: 202, origin_id: -10, origin_slot: 1, target_id: 1, target_slot: 1, type: "STRING" },
              { id: 203, origin_id: -10, origin_slot: 2, target_id: 2, target_slot: 0, type: "COMBO" },
            ],
          },
        ],
      },
    };
    const { graph } = toApi(wf, info);
    expect(graph["40:1"].inputs.text).toBe("a lighthouse at dusk");
    expect(graph["40:2"].inputs.vae_name).toBe("ae.safetensors");
  });

  it("passes API exports through and lists missing node packs", () => {
    const api = { "1": { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "x" } }, "2": { class_type: "SomeCustomNode", inputs: {} } };
    expect(toApi(api, info).missing).toEqual(["SomeCustomNode"]);
  });

  it("refuses files that are not workflows", () => {
    expect(() => toApi({ hello: "world" }, info)).toThrow(/not a ComfyUI workflow/);
  });
});

describe("reading a workflow like a person", () => {
  const { graph, titles } = toApi(canvas, info);
  const fields = detectFields(graph, info, titles);
  const role = (r: string) => fields.filter((f) => f.role === r);

  it("finds the prompt, the negative, the seed and the size", () => {
    expect(role("prompt").map((f) => f.value)).toEqual(["a red fox in snow"]);
    expect(role("prompt")[0].label).toBe("Positive");
    expect(role("negative").map((f) => f.value)).toEqual(["blurry, low quality"]);
    expect(role("seed")).toHaveLength(1);
    expect(role("width")[0].value).toBe(1024);
    expect(role("height")[0].value).toBe(1024);
    expect(detectOutput(graph, info)).toBe("image");
  });

  it("drives the workflow from a Studio shot", () => {
    const recipe: Recipe = { id: "r1", name: "Fox", source: "fox.json", createdAt: 0, updatedAt: 0, graph, fields, output: "image", fps: null, missing: [], warnings: [] };
    expect(isEngine(recipe)).toBe(true);
    const { values } = fillForShot(recipe, { prompt: "a fox leaps", aspect: 16 / 9, seconds: 5, seed: 99, cast: [] });
    const { graph: out } = applyValues(recipe, values);
    expect(out["3"].inputs.text).toBe("a fox leaps");
    expect(out["4"].inputs.text).toBe("blurry, low quality");
    expect(out["5"].inputs.width).toBe(1360); // same pixel budget, reshaped to 16:9 on its 16-px grid
    expect(out["5"].inputs.height).toBe(768);
    expect(out["6"].inputs.seed).toBe(99);

    const shot = { kind: "shot", prompt: "@Mira looks up", cast: [{ name: "mira.png", kind: "image", url: "", label: "Mira" }], size: "close", angle: "low", lens: 85, move: "push_in", intensity: 1, cameraMode: "rig", rigStyle: "subject", lighting: "neon", film: { look: "noir", intensity: 1, grain: 0, halation: 0, vignette: 0, chromatic: 0, gateWeave: 0, streak: 0 }, filmOnGpu: false, aspect: "9:16", quality: "draft", duration: 5, seed: 5, turbo: true, smooth: false, sound: false, engine: "r1" } as ShotSpec;
    const compiled = compile(shot, NO_CAPABILITIES, { recipes: { r1: recipe } });
    const text = String(compiled.graph["3"].inputs.text);
    expect(text).toMatch(/^Mira looks up\./); // a plain name, never H3's <Picture 1> tag
    expect(text).toMatch(/close-up/);
    expect(text).not.toMatch(/<Picture/);
    expect(compiled.graph["5"].inputs.height).toBeGreaterThan(compiled.graph["5"].inputs.width as number);
    expect(validateGraph(compiled.graph, info)).toEqual([]);
  });
});

describe("custom nodes", () => {
  // Stand-ins for nodes from custom packs, shaped like the server describes them.
  const custom: ObjectInfo = {
    ...info,
    NFDualEncode: {
      input: { required: { clip: ["CLIP", {}], positive_prompt: ["STRING", { multiline: true }], negative_prompt: ["STRING", { multiline: true }] } },
      output: ["CONDITIONING", "CONDITIONING"],
    },
    NFLoadPicture: { input: { required: { picture: [["fox.png", "owl.jpg", "cat.webp"], {}] } }, output: ["IMAGE"] },
    NFPictureToLatent: { input: { required: { image: ["IMAGE", {}] } }, output: ["LATENT"] },
    NFPaidImage: { input: { required: { prompt: ["STRING", { multiline: true }] } }, output: ["IMAGE"], api_node: true },
  };
  const graph = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "flux1-krea-dev.safetensors", weight_dtype: "default" } },
    "2": { class_type: "DualCLIPLoader", inputs: { clip_name1: "clip_l.safetensors", clip_name2: "t5xxl_fp16.safetensors", type: "flux", device: "default" } },
    "3": { class_type: "NFDualEncode", inputs: { clip: ["2", 0], positive_prompt: "an owl at dusk", negative_prompt: "watermark" } },
    "4": { class_type: "NFLoadPicture", inputs: { picture: "owl.jpg" } },
    "5": { class_type: "NFPictureToLatent", inputs: { image: ["4", 0] } },
    "6": {
      class_type: "KSampler",
      // image_3 stands for an input a browser extension added to the node.
      inputs: { model: ["1", 0], positive: ["3", 0], negative: ["3", 1], latent_image: ["5", 0], seed: 1, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, image_3: ["4", 0] },
    },
    "7": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "8": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["7", 0] } },
    "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "owl" } },
  } as const;

  it("tells a node's positive and negative prompts apart by name", () => {
    const fields = detectFields(structuredClone(graph) as never, custom);
    const text = fields.filter((f) => f.kind === "text");
    expect(text.map((f) => [f.input, f.role, f.label])).toEqual([
      ["positive_prompt", "prompt", "Positive prompt"],
      ["negative_prompt", "negative", "Negative prompt"],
    ]);
  });

  it("finds a custom loader's picture input from its file list", () => {
    const pic = detectFields(structuredClone(graph) as never, custom).find((f) => f.node === "4");
    expect(pic?.kind).toBe("image");
    expect(pic?.role).toBe("image");
  });

  it("warns about inputs a browser extension added, without blocking", () => {
    const issues = validateGraph(structuredClone(graph) as never, custom);
    expect(errorsOf(issues)).toEqual([]);
    expect(warningsOf(issues).map((i) => i.input)).toEqual(["image_3"]);
  });

  it("reads a chosen model's own settings, like its aspect ratio", () => {
    const withModels: ObjectInfo = {
      ...custom,
      NFBanana: {
        api_node: true,
        output_node: true,
        input: {
          required: {
            prompt: ["STRING", { multiline: true }],
            model: [
              "COMFY_DYNAMICCOMBO_V3",
              { options: [{ key: "Banana 2", inputs: { required: { aspect_ratio: ["COMBO", { options: ["auto", "1:1", "16:9", "9:16"] }], resolution: ["COMBO", { options: ["1K", "2K"] }] } } }] },
            ],
          },
        },
        output: ["IMAGE"],
      } as never,
    };
    const g = { "1": { class_type: "NFBanana", inputs: { prompt: "a fox", model: "Banana 2", "model.aspect_ratio": "auto", "model.resolution": "1K" } } };
    const fields = detectFields(g as never, withModels);
    const aspect = fields.find((f) => f.input === "model.aspect_ratio");
    expect(aspect).toMatchObject({ role: "aspect", label: "Aspect ratio", exposed: true });
    const recipe: Recipe = { id: "b", name: "Banana", source: "b.json", createdAt: 0, updatedAt: 0, graph: g as never, fields, output: "image", fps: null, missing: [], warnings: [] };
    const { values } = fillForShot(recipe, { prompt: "a fox", aspect: 9 / 16, seconds: 5, seed: 1, cast: [] });
    expect(applyValues(recipe, values).graph["1"].inputs["model.aspect_ratio"]).toBe("9:16");
  });

  it("spots paid API nodes", () => {
    const paid = { "1": { class_type: "NFPaidImage", inputs: { prompt: "a fox" } }, "2": { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "x" } } };
    expect(apiNodes(paid as never, custom)).toEqual(["NFPaidImage"]);
    expect(apiNodes(structuredClone(graph) as never, custom)).toEqual([]);
  });
});

describe("size by aspect ratio and pixels", () => {
  const side = (id: string, value: number): Field => ({ id, node: "5", input: id, label: id, group: "Latent", kind: "number", role: id as Role, value, min: 16, max: 4096, step: 8, integer: true, exposed: true, advanced: false });
  const W = side("width", 1520);
  const H = side("height", 1024);
  const base = 1520 * 1024;

  it("keeps the pixel count, lands on the ratio and on multiples of 16", () => {
    for (const r of SIZE_RATIOS) {
      const { width, height } = sizeFor(W, H, r.ratio, base);
      expect(width % 16, r.id).toBe(0);
      expect(height % 16, r.id).toBe(0);
      expect(Math.abs(Math.log(width / height / r.ratio)), r.id).toBeLessThan(0.03);
      expect(Math.abs((width * height) / base - 1), r.id).toBeLessThan(0.05);
    }
  });

  it("scales pixels with the multiplier and stays inside the field limits", () => {
    const two = sizeFor(W, H, 16 / 9, base * 2);
    expect(Math.abs((two.width * two.height) / (base * 2) - 1)).toBeLessThan(0.05);
    const huge = sizeFor({ ...W, max: 2048 }, { ...H, max: 2048 }, 21 / 9, base * 4);
    expect(huge.width).toBeLessThanOrEqual(2048);
  });
});


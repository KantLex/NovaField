import { describe, expect, it } from "vitest";
import imageInfo from "../../test/fixtures/image_info.json";
import { validateGraph, type ObjectInfo } from "../comfy/validate";
import { titleFor } from "../jobs";
import { detectCapabilities, NO_CAPABILITIES } from "./capabilities";
import { expandPadding, upscaleSize } from "./image";
import { blocker, compile } from "./index";
import type { Asset, ImageSpec } from "./specs";

const info = imageInfo as unknown as ObjectInfo;
const caps = detectCapabilities(info);
const portrait: Asset = { name: "hero.png", kind: "image", url: "/hero.png", width: 832, height: 1216, label: "Hero still" };
const spec = (over: Partial<ImageSpec> = {}): ImageSpec => ({ kind: "image", tool: "edit", image: portrait, prompt: "make it night", seed: 7, ...over });
const classes = (s: ImageSpec) => Object.values(compile(s, caps).graph).map((n) => n.class_type);

describe("the picture tools", () => {
  it("finds both editing models and the upscaler on a server that has them", () => {
    expect(caps.image).toEqual({ qwen: true, kontext: true, upscale: true, plainAttention: false });
    expect(detectCapabilities({}).image).toEqual(NO_CAPABILITIES.image);
  });

  it("builds graphs the server accepts, for every tool and model", () => {
    for (const s of [spec(), spec({ model: "kontext" }), spec({ tool: "expand", prompt: "", aspect: "16:9" }), spec({ tool: "upscale", prompt: "" })]) {
      expect(validateGraph(compile(s, caps).graph, info)).toEqual([]);
      expect(blocker(s, caps)).toBeNull();
    }
  });

  it("edits with Qwen Image Edit by default, and Flux Kontext when asked", () => {
    expect(classes(spec())).toContain("TextEncodeQwenImageEdit");
    // SageAttention turns Qwen's pictures black: the model goes back to PyTorch attention when the server can.
    expect(classes(spec())).not.toContain("ModelAttentionBackend");
    expect(Object.values(compile(spec(), { ...caps, image: { ...caps.image, plainAttention: true } }).graph).map((n) => n.class_type)).toContain("ModelAttentionBackend");
    const kontext = compile(spec({ model: "kontext" }), caps);
    expect(Object.values(kontext.graph).map((n) => n.class_type)).toContain("ReferenceLatent");
    expect(kontext.meta.engine).toBe("Flux Kontext");
    // Without Qwen on the server, an edit falls back to Kontext.
    expect(compile(spec(), { ...caps, image: { ...caps.image, qwen: false } }).meta.engine).toBe("Flux Kontext");
  });

  it("widens the frame by padding both sides evenly, then asks the model to fill the border", () => {
    expect(expandPadding(portrait, 16 / 9)).toEqual({ left: 664, right: 664, top: 0, bottom: 0 });
    expect(expandPadding({ ...portrait, width: 1920, height: 1080 }, 9 / 16)).toMatchObject({ left: 0, top: 1168, bottom: 1168 });
    const { graph, meta } = compile(spec({ tool: "expand", prompt: "a busy harbour", aspect: "16:9" }), caps);
    const pad = Object.values(graph).find((n) => n.class_type === "ImagePadForOutpaint")!;
    expect(pad.inputs).toMatchObject({ left: 664, right: 664, top: 0, bottom: 0 });
    expect(meta.prompt).toMatch(/grey border.*In the new space: a busy harbour\./);
    expect(meta.width / meta.height).toBeCloseTo(16 / 9, 1);
  });

  it("refuses an expand to the shape the picture already has", () => {
    const square = { ...portrait, width: 1024, height: 1024 };
    expect(blocker(spec({ tool: "expand", image: square, aspect: "1:1" }), caps)).toMatch(/already that shape/);
  });

  it("upscales up to about four megapixels and turns creativity into denoise", () => {
    expect(upscaleSize(portrait, 2)).toMatchObject({ width: 1664, height: 2432 });
    // A 1080p frame can't double without going past the cap.
    const big = upscaleSize({ ...portrait, width: 1920, height: 1080 }, 2);
    expect(big.width * big.height).toBeLessThanOrEqual(4_300_000);
    const sampler = (c: number) => Object.values(compile(spec({ tool: "upscale", creativity: c }), caps).graph).find((n) => n.class_type === "KSampler")!.inputs.denoise;
    expect(sampler(0)).toBe(0.15);
    expect(sampler(1)).toBe(0.55);
    expect(blocker(spec({ tool: "upscale", image: { ...portrait, width: 2048, height: 2048 } }), caps)).toMatch(/already as large/);
  });

  it("says what's missing instead of failing on the GPU", () => {
    expect(blocker(spec({ prompt: "  " }), caps)).toBe("Say what to change.");
    expect(blocker(spec(), NO_CAPABILITIES)).toMatch(/Qwen Image Edit or Flux Kontext/);
    expect(blocker(spec({ tool: "upscale" }), NO_CAPABILITIES)).toMatch(/Z Image Turbo/);
  });

  it("names the new take after the step", () => {
    expect(titleFor(spec())).toBe("Edit: make it night");
    expect(titleFor(spec({ tool: "upscale", scale: 2 }))).toBe("Upscale ×2: Hero still");
    expect(titleFor(spec({ tool: "expand", aspect: "2.39:1", prompt: "" }))).toBe("Expand to 2.39:1: Hero still");
  });
});

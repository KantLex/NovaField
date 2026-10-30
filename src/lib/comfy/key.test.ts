import { describe, expect, it } from "vitest";
import { looksLikeComfyKey } from "./key";

describe("looksLikeComfyKey", () => {
  it("accepts a copied key, stray whitespace included", () => {
    expect(looksLikeComfyKey("comfyui-3f9a8c7e1b2d4f60a9e8b7c6d5e4f3a2")).toBe(true);
    expect(looksLikeComfyKey("  comfyui-3f9a8c7e1b2d4f60a9e8b7c6d5e4f3a2\n")).toBe(true);
  });

  it("ignores whatever else is on the clipboard", () => {
    expect(looksLikeComfyKey("https://platform.comfy.org/profile/api-keys")).toBe(false);
    expect(looksLikeComfyKey("comfyui-short")).toBe(false);
    expect(looksLikeComfyKey("a cinematic shot of a lighthouse")).toBe(false);
  });
});

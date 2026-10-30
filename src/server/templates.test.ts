import { describe, expect, it } from "vitest";
import { cardMedia } from "./templates";

describe("cardMedia", () => {
  it("takes what a template makes from its category, not its thumbnail", () => {
    expect(cardMedia("video", "image")).toBe("video");
    expect(cardMedia("3d", "image")).toBe("3d");
    expect(cardMedia("audio", undefined)).toBe("audio");
  });

  it("falls back to the template's own type when the category names no output", () => {
    expect(cardMedia("llm", "image")).toBe("image");
    expect(cardMedia(undefined, "audio")).toBe("audio");
    expect(cardMedia(undefined, undefined)).toBe("image");
  });
});

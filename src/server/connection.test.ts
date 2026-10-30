import { describe, expect, it } from "vitest";
import { comfyHeaders, comfyUrl, normalizeUrl, type Connection } from "./connection";

const local: Connection = { mode: "local", url: "http://127.0.0.1:8188", cloudKey: "", apiKey: "" };
const cloud: Connection = { mode: "cloud", url: "http://127.0.0.1:8188", cloudKey: "k-123", apiKey: "" };

describe("connection", () => {
  it("keeps local paths as ComfyUI serves them", () => {
    expect(comfyUrl("/object_info", undefined, local)).toBe("http://127.0.0.1:8188/object_info");
    expect(comfyUrl("/api/userdata?dir=workflows", undefined, local)).toBe("http://127.0.0.1:8188/api/userdata?dir=workflows");
  });

  it("puts Cloud's API under /api, once, and leaves static files at the root", () => {
    expect(comfyUrl("/prompt", undefined, cloud)).toBe("https://cloud.comfy.org/api/prompt");
    expect(comfyUrl("/api/userdata", undefined, cloud)).toBe("https://cloud.comfy.org/api/userdata");
    expect(comfyUrl("/templates/index.json", { raw: true }, cloud)).toBe("https://cloud.comfy.org/templates/index.json");
  });

  it("sends the key only to Cloud", () => {
    expect(comfyHeaders(undefined, cloud).get("X-API-Key")).toBe("k-123");
    expect(comfyHeaders(undefined, local).get("X-API-Key")).toBeNull();
  });

  it("tidies typed addresses", () => {
    expect(normalizeUrl(" 192.168.1.20:8188/ ")).toBe("http://192.168.1.20:8188");
    expect(normalizeUrl("https://comfy.example.com")).toBe("https://comfy.example.com");
  });
});

import { describe, expect, it } from "vitest";
import type { ApiGraph } from "./graph";
import { formatCredits, priceGraph } from "./pricing";
import type { ObjectInfo } from "./validate";

// Price formulas in the shape ComfyUI ships them (trimmed from real nodes).
const info = {
  LoadImage: { input: { required: { image: [["a.png"], {}] } }, output: ["IMAGE"] },
  FluxPro: {
    api_node: true,
    output_node: true,
    input: { required: { width: ["INT", { default: 1024 }], height: ["INT", { default: 1024 }] }, optional: { images: ["IMAGE", {}] } },
    output: ["IMAGE"],
    price_badge: {
      engine: "jsonata",
      depends_on: { widgets: [{ name: "width", type: "INT" }, { name: "height", type: "INT" }], inputs: ["images"], input_groups: [] },
      expr: `(
        $MP := 1024 * 1024;
        $outMP := $max([1, $floor(((widgets.width * widgets.height) + $MP - 1) / $MP)]);
        $cost := 0.03 + 0.015 * ($outMP - 1);
        inputs.images.connected
          ? {"type":"range_usd","min_usd": $cost + 0.015,"max_usd": $cost + 0.12,"format":{"approximate":true}}
          : {"type":"usd","usd": $cost}
      )`,
    },
  },
  Chat: {
    api_node: true,
    output_node: true,
    input: { required: { model: [["Fable 5", "Opus 5"], {}] } },
    output: ["STRING"],
    price_badge: {
      depends_on: { widgets: [{ name: "model", type: "COMBO" }] },
      expr: `$contains(widgets.model, "fable") ? {"type":"list_usd","usd":[0.01,0.05],"format":{"suffix":" per 1K tokens"}} : {"type":"usd","usd":0.1}`,
    },
  },
} as unknown as ObjectInfo;

describe("API node prices", () => {
  it("prices a node from its own settings", async () => {
    const graph: ApiGraph = { "1": { class_type: "FluxPro", inputs: { width: 2048, height: 1024 } } };
    const p = await priceGraph(graph, info);
    expect(p?.minUsd).toBeCloseTo(0.045);
    expect(p?.approximate).toBe(false);
  });

  it("knows when a picture input is connected", async () => {
    const graph: ApiGraph = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "FluxPro", inputs: { width: 1024, height: 1024, images: ["1", 0] } },
    };
    const p = await priceGraph(graph, info);
    expect([p?.minUsd, p?.maxUsd]).toEqual([0.045, 0.15]);
    expect(p?.approximate).toBe(true);
  });

  it("lower-cases choices like ComfyUI and flags per-unit rates", async () => {
    const p = await priceGraph({ "1": { class_type: "Chat", inputs: { model: "Fable 5" } } }, info);
    expect(p?.nodes[0]).toMatchObject({ minUsd: 0.01, maxUsd: 0.05, per: "per 1K tokens", approximate: true });
  });

  it("adds up every paid node and ignores free ones", async () => {
    const p = await priceGraph(
      { "1": { class_type: "FluxPro", inputs: {} }, "2": { class_type: "Chat", inputs: { model: "Opus 5" } } },
      info,
    );
    expect(p?.minUsd).toBeCloseTo(0.13);
    expect(await priceGraph({ "1": { class_type: "LoadImage", inputs: { image: "a.png" } } }, info)).toBeNull();
  });

  it("shows credits like ComfyUI", () => {
    expect(formatCredits(0.03, 0.03, false)).toBe("6.3");
    expect(formatCredits(0.5, 0.5, true)).toBe("≈ 106");
    expect(formatCredits(0.045, 0.15, true)).toBe("9.5–32");
  });
});

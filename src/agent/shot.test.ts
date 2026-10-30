import { describe, expect, it } from "vitest";
import type { RecipeSummary } from "@/lib/workflows/types";
import { buildShot, checkShot, workflowValues } from "./shot";

describe("buildShot", () => {
  it("fills the Studio's defaults around what the agent asked for", () => {
    const s = buildShot({ prompt: "  a keeper climbs the stairs ", move: "crane_up", lens: 85, look: "noir", seed: 7 });
    expect(s).toMatchObject({ kind: "shot", prompt: "a keeper climbs the stairs", move: "crane_up", lens: 85, size: "medium", aspect: "16:9", quality: "draft", duration: 5, seed: 7, cameraMode: "rig", combo: null, rig: null });
    expect(s.film.look).toBe("noir");
    expect(buildShot({ prompt: "x" }).seed).toBeGreaterThan(0);
  });

  it("names every word it doesn't know", () => {
    expect(checkShot({ prompt: "x", move: "push_in", lens: 35, size: "close", lighting: "neon", look: "teal_orange" })).toEqual([]);
    expect(checkShot({ prompt: " ", move: "moonwalk", lens: 40, combo: [{ id: "spin", intensity: 1, when: "whole" }], aspect: "5:4" as never })).toEqual([
      "prompt is empty",
      'unknown move "moonwalk" (see novafield://camera/moves)',
      'unknown move "spin" in combo',
      "lens must be one of 14, 24, 35, 50, 85, 135 mm",
      "aspect must be one of 16:9, 9:16, 1:1, 2.39:1, 4:3",
    ]);
  });
});

describe("workflowValues", () => {
  const field = (id: string, role: string, exposed = true) => ({ id, node: id.split(".")[0], input: id.split(".")[1], kind: "text", role, label: id, group: "", value: "", exposed, advanced: false });
  const recipe = { id: "r1", name: "Flux", fields: [field("5.text", "negative"), field("4.text", "prompt", false), field("3.text", "prompt"), field("9.image", "image"), field("10.image", "image")] } as unknown as RecipeSummary;

  it("fills fields by role, exposed fields first, and lists across fields", () => {
    expect(workflowValues(recipe, { prompt: "a fox", image: ["a.png", "b.png"] }).values).toEqual({ "3.text": "a fox", "9.image": "a.png", "10.image": "b.png" });
  });

  it("lets a field id win over a role, and reports what doesn't exist", () => {
    const r = workflowValues(recipe, { prompt: "a fox", seed: 1 }, { "3.text": "exact", "99.x": 1 });
    expect(r.values["3.text"]).toBe("exact");
    expect(r.unknown).toEqual(['role "seed"', 'field "99.x"']);
  });
});

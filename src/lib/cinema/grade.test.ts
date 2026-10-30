import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { weaveWalk } from "@/ui/grade/GradeCanvas";
import { DEFAULT_GRADE, gradeBlend, gradePixel, isIdentity, LOOK_PARAMS } from "./grade";
import { LOOKS } from "./looks";

// The GPU node's look table, read from its source without importing torch.
function pythonLooks(): Record<string, unknown> | null {
  const file = path.resolve(__dirname, "../../../comfyui-novafield/nova/lens_film.py");
  const script = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
env = {}
for node in tree.body:
    target = node.targets[0] if isinstance(node, ast.Assign) else node.target if isinstance(node, ast.AnnAssign) else None
    if isinstance(target, ast.Name) and target.id in ("_I", "LOOK_PARAMS"):
        src = ast.unparse(node.value).replace("dict(", "_dict(")
        env[target.id] = eval(src, {"_dict": dict, "_I": env.get("_I"), "True": True})
print(json.dumps(env["LOOK_PARAMS"]))`;
  try {
    return JSON.parse(execFileSync("python3", ["-c", script, file], { encoding: "utf8" }));
  } catch {
    return null;
  }
}

describe("the film looks in the browser", () => {
  const py = pythonLooks();
  it.skipIf(!py)("use the same numbers as NovaLensFilm on the GPU", () => {
    expect(JSON.parse(JSON.stringify(LOOK_PARAMS))).toEqual(py);
  });

  it("cover every look the picker offers", () => {
    expect(Object.keys(LOOK_PARAMS).sort()).toEqual(LOOKS.filter((l) => l.id !== "none").map((l) => l.id).sort());
  });

  it("grade a pixel the way the node does", () => {
    // Noir is black and white; a mid grey stays near its pivot.
    const [r, g, b] = gradePixel([0.8, 0.2, 0.1], "noir");
    expect(r).toBeCloseTo(g, 6);
    expect(g).toBeCloseTo(b, 6);
    // Moonlight darkens and cools.
    const moon = gradePixel([0.6, 0.6, 0.6], "moonlight");
    expect(moon[2]).toBeGreaterThan(moon[0]);
    expect(moon[0]).toBeLessThan(0.6);
    // Strength 0 leaves the pixel alone; full strength is the look itself.
    expect(gradeBlend([0.3, 0.4, 0.5], { look: "kodak_2383", intensity: 0 })).toEqual([0.3, 0.4, 0.5]);
    expect(gradeBlend([0.3, 0.4, 0.5], { look: "kodak_2383", intensity: 1 })).toEqual(gradePixel([0.3, 0.4, 0.5], "kodak_2383"));
  });

  it("knows when a grade changes nothing", () => {
    expect(isIdentity({ ...DEFAULT_GRADE, look: "none", grain: 0, halation: 0, vignette: 0 })).toBe(true);
    expect(isIdentity({ ...DEFAULT_GRADE, look: "kodak_2383", intensity: 0, grain: 0, halation: 0, vignette: 0 })).toBe(true);
    expect(isIdentity(DEFAULT_GRADE)).toBe(false);
  });

  it("weaves the gate the same way for the same seed", () => {
    const a = weaveWalk(48, 7);
    expect(a).toHaveLength(48);
    expect(weaveWalk(48, 7)).toEqual(a);
    expect(weaveWalk(48, 8)).not.toEqual(a);
    const spread = Math.sqrt(a.reduce((s, [x]) => s + x * x, 0) / a.length);
    expect(spread).toBeGreaterThan(0.3);
    expect(spread).toBeLessThan(3);
  });
});

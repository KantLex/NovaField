import { describe, expect, it } from "vitest";
import { mainOutput, type HistoryEntry } from "./comfy";

const file = (filename: string, type: string) => ({ filename, subfolder: "", type });

describe("a prompt's result", () => {
  it("skips the source clip a Load node lists, and takes what was saved", () => {
    // What newer ComfyUI reports for a recast: LoadVideo's input first, then SaveVideo's result.
    const entry: HistoryEntry = {
      outputs: {
        "6": { images: [file("nf_source.mp4", "input")], animated: [true] },
        "17": { images: [file("recast_00001_.mp4", "output")], animated: [true] },
      },
    };
    expect(mainOutput(entry)).toEqual({ file: file("recast_00001_.mp4", "output"), kind: "video" });
  });

  it("prefers saved files over previews, and falls back to a preview", () => {
    expect(mainOutput({ outputs: { a: { images: [file("p.png", "temp")] }, b: { images: [file("s.png", "output")] } } })?.file.filename).toBe("s.png");
    expect(mainOutput({ outputs: { a: { gifs: [file("v.mp4", "temp")] } } })?.kind).toBe("video");
    expect(mainOutput({ outputs: { a: { images: [file("ref.png", "input")] } } })).toBeNull();
  });

  it("takes a saved 3D model, with a picture the workflow saved as its poster", () => {
    // SaveGLB lists its file under "3d"; a preview render sits beside it.
    const entry: HistoryEntry = {
      outputs: {
        "9": { images: [file("front_00001_.png", "output")] },
        "12": { "3d": [{ filename: "mesh_00001_.glb", subfolder: "3d", type: "output" }] },
      },
    };
    expect(mainOutput(entry)).toEqual({ file: { filename: "mesh_00001_.glb", subfolder: "3d", type: "output" }, kind: "model", poster: file("front_00001_.png", "output") });
  });

  it("finds a model Preview3D only names by its path", () => {
    const entry: HistoryEntry = { outputs: { "4": { result: ["mesh/ComfyUI_00003_.glb", { position: [0, 0, 1] }] } } };
    expect(mainOutput(entry)).toEqual({ file: { filename: "ComfyUI_00003_.glb", subfolder: "mesh", type: "output" }, kind: "model" });
  });

  it("finds a model file under any key, and ignores files that aren't models", () => {
    expect(mainOutput({ outputs: { a: { meshes: [file("thing.obj", "output")] } } as HistoryEntry["outputs"] })?.kind).toBe("model");
    expect(mainOutput({ outputs: { a: { result: ["notes.txt"] } } })).toBeNull();
  });
});

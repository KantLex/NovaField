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
});

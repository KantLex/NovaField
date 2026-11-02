// Which shots get the 3D previs drawn as their guide when Create is pressed.

import { describe, expect, it } from "vitest";
import type { ShotSpec } from "@/lib/engines/specs";
import { DEFAULT_SHOT } from "../state";
import { usesGuide } from "./guide";

const spec = (over: Partial<ShotSpec> = {}): ShotSpec => ({ ...DEFAULT_SHOT, kind: "shot", seed: 1, ...over });

describe("the 3D previs guide", () => {
  it("is drawn for a moving H3 shot with the 3D set as its previs (the default)", () => {
    expect(spec().rigStyle).toBe("set3d");
    expect(usesGuide(spec())).toBe(true);
  });

  it("isn't drawn when something else steers the camera, or nothing moves", () => {
    expect(usesGuide(spec({ cameraMode: "prompt" }))).toBe(false);
    expect(usesGuide(spec({ rigStyle: "subject" }))).toBe(false);
    expect(usesGuide(spec({ engine: "some-workflow" }))).toBe(false);
    expect(usesGuide(spec({ previs: { clip: { name: "mine.mp4", kind: "video", url: "/x.mp4" }, follow: "camera" } }))).toBe(false);
    expect(usesGuide(spec({ off: { move: true } }))).toBe(false);
    expect(usesGuide(spec({ move: "locked" }))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { CameraPath } from "./camera";
import { describeBlocking, describeSet } from "./custom";

const path = (extra: Partial<CameraPath>): CameraPath => ({
  version: 1,
  frames: 49,
  fps: 24,
  ease: "linear",
  keys: [{ t: 0, pos: [0, 1.6, 6], target: [0, 1.2, 0], fov: 40, roll: 0 }],
  actors: [{ from: [0, 0], to: [0, 0], height: 1.75 }],
  ...extra,
});

describe("set pieces in words", () => {
  it("says where each piece stands as the opening camera sees it", () => {
    const text = describeSet(
      path({
        props: [
          { label: "Table", at: [-1.2, 2.5], size: [1.6, 0.75, 0.9] },
          { label: "Car", at: [2, -3], size: [4.5, 1.45, 1.8] },
          { label: "Red armchair", at: [0, -2], size: [1, 1, 1] },
          { label: "Tree", at: [0, 9], size: [2, 4, 2] },
        ],
      }),
    );
    expect(text).toBe("On the set: a table in the foreground, at frame left; a car behind the subject, at frame right; and the red armchair behind the subject, in the middle of the frame.");
  });

  it("uses a set piece's own name over its kind", () => {
    const text = describeSet(path({ props: [{ label: "Table", name: "weathered wooden picnic table", at: [0, -2], size: [1.6, 0.75, 0.9] }] }));
    expect(text).toBe("On the set: the weathered wooden picnic table behind the subject, in the middle of the frame.");
  });

  it("says nothing without set pieces", () => {
    expect(describeSet(path({}))).toBe("");
  });
});

describe("stand-ins facing each other", () => {
  it("names whom a stand-in is turned toward", () => {
    const text = describeBlocking(
      path({
        actors: [
          { from: [-1, 0], to: [-1, 0], height: 1.75, turn: 90, action: "talk" },
          { from: [1, 0], to: [1, 0], height: 1.75, turn: -90 },
        ],
      }),
    );
    expect(text).toBe("The main subject talks, gesturing with their hands, facing the second person. The second person stands facing the main subject.");
  });
});

describe("what a walker does on arrival", () => {
  const walker = (extra: object) => describeBlocking(path({ actors: [{ from: [-2, 0], to: [0, 0], height: 1.75, ...extra }] }));
  it("follows the walk with it", () => {
    expect(walker({ end: 0.5, then: "wave" })).toBe("The main subject walks across the frame from left to right in the first half of the shot, then waves.");
    expect(walker({ start: 0.4, end: 0.5, then: "sit" })).toBe("The main subject walks across the frame from left to right halfway through the shot, then sits.");
  });
  it("says nothing of it when the walk takes the whole shot", () => {
    expect(walker({ then: "wave" })).toBe("The main subject walks across the frame from left to right.");
  });
});

import { describe, expect, it } from "vitest";
import { parseBox, parseClip, parseFrameMove, parsePairs, parsePath, parseRef } from "./cliArgs";

describe("parseRef", () => {
  it("reads prefixed refs, bare ids and file paths", () => {
    expect(parseRef("asset:b301381f")).toEqual({ from: "asset", id: "b301381f" });
    expect(parseRef("take:7d83417c@2.5")).toEqual({ from: "take", id: "7d83417c", at: 2.5 });
    expect(parseRef("7d83417c")).toEqual({ from: "id", id: "7d83417c" });
    expect(parseRef("7d83417c@1")).toEqual({ from: "id", id: "7d83417c", at: 1 });
    expect(parseRef("./hana.png")).toEqual({ from: "file", path: "./hana.png" });
    expect(parseRef("file:cafebabe")).toEqual({ from: "file", path: "cafebabe" });
  });

  it("says what's wrong", () => {
    expect(() => parseRef(" ")).toThrow(/empty/);
    expect(() => parseRef("take:7d83417c@soon")).toThrow(/seconds/);
  });
});

describe("parseBox", () => {
  it("reads x,y,w,h and an optional time", () => {
    expect(parseBox("0.4,0.3,0.2,0.4")).toEqual({ x: 0.4, y: 0.3, w: 0.2, h: 0.4 });
    expect(parseBox("0.4, 0.3, 0.2, 0.4@1.5")).toEqual({ x: 0.4, y: 0.3, w: 0.2, h: 0.4, at: 1.5 });
  });

  it("refuses boxes outside the frame or with the wrong shape", () => {
    expect(() => parseBox("0.4,0.3,0.2")).toThrow(/x,y,w,h/);
    expect(() => parseBox("1.4,0.3,0.2,0.2")).toThrow(/0 to 1/);
    expect(() => parseBox("0.4,0.3,0.2,0.2@-1")).toThrow(/seconds/);
  });
});

describe("parsePath", () => {
  it("reads points, timing and ease", () => {
    expect(parsePath("0.5,0.5")).toEqual({ points: [[0.5, 0.5]] });
    expect(parsePath("0.2,0.6 0.7,0.5@0.1-0.8:out")).toEqual({
      points: [
        [0.2, 0.6],
        [0.7, 0.5],
      ],
      start: 0.1,
      end: 0.8,
      ease: "out",
    });
    expect(parsePath("0.2,0.6;0.7,0.5:linear").ease).toBe("linear");
  });

  it("refuses bad points and unknown eases", () => {
    expect(() => parsePath("0.2 0.6")).toThrow(/x,y/);
    expect(() => parsePath("0.2,1.6")).toThrow(/0 to 1/);
    expect(() => parsePath("0.2,0.6:bouncy")).toThrow(/ease/);
  });
});

describe("parseFrameMove", () => {
  it("reads a move and an optional amount", () => {
    expect(parseFrameMove("pan_left")).toEqual({ move: "pan_left" });
    expect(parseFrameMove("push_in:0.2")).toEqual({ move: "push_in", amount: 0.2 });
    expect(() => parseFrameMove("push_in:0.9")).toThrow(/0.05 to 0.4/);
  });
});

describe("parsePairs", () => {
  it("types numbers and booleans, and lists repeated keys", () => {
    expect(parsePairs(["prompt=a fox, at dusk", "seed=7", "tiled=false", "image=a.png", "image=b.png", "neg="])).toEqual({
      prompt: "a fox, at dusk",
      seed: 7,
      tiled: false,
      image: ["a.png", "b.png"],
      neg: "",
    });
    expect(() => parsePairs(["=7"], "Role")).toThrow(/Role "=7"/);
  });
});

describe("parseClip", () => {
  it("reads whole takes, ranges, joins and mutes", () => {
    expect(parseClip("55d62d2b")).toEqual({ take: "55d62d2b" });
    expect(parseClip("55d62d2b:1.5-4:dissolve!")).toEqual({ take: "55d62d2b", in: 1.5, out: 4, join: "dissolve", muted: true });
    expect(() => parseClip("55d62d2b:4-1")).toThrow(/in-out/);
    expect(() => parseClip("55d62d2b:1-4:wipe")).toThrow(/cut or dissolve/);
  });
});

describe("forms the help advertises", () => {
  it("reads a join with no range, and a take: prefix", () => {
    expect(parseClip("abc12345:dissolve")).toEqual({ take: "abc12345", join: "dissolve" });
    expect(parseClip("take:abc12345:1-2")).toEqual({ take: "abc12345", in: 1, out: 2 });
  });

  it("treats a file that starts like an id as a file", () => {
    expect(parseRef("abcd1234@2x.png")).toEqual({ from: "file", path: "abcd1234@2x.png" });
    expect(parseRef("abcd1234@2.5")).toEqual({ from: "id", id: "abcd1234", at: 2.5 });
  });
});

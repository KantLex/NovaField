import { describe, expect, it } from "vitest";
import serverInfo from "../../test/fixtures/object_info.min.json";
import packInfo from "../../test/fixtures/pack_info.json";
import { validateGraph, type ObjectInfo } from "../comfy/validate";
import { detectCapabilities } from "./capabilities";
import { NEWER_STOCK_NOTE, RIG_OFF_NOTE } from "./h3";
import { compile } from "./index";
import { h3Frames, h3FramesAtMost, planH3 } from "./sizing";
import { composeShotPrompt, resolveMentions } from "./prompt";
import { resamplePath } from "./wan";
import type { Asset, JobSpec, ShotSpec } from "./specs";

const withPack = { ...(serverInfo as unknown as ObjectInfo), ...(packInfo as unknown as ObjectInfo) };
const withoutPack = serverInfo as unknown as ObjectInfo;

const img = (name: string, label?: string): Asset => ({ name, kind: "image", url: "", label });
const vid = (name: string, frames: number, w = 1280, h = 720, fps = 24): Asset => ({
  name,
  kind: "video",
  url: "",
  frames,
  width: w,
  height: h,
  fps,
  duration: frames / fps,
});

const film = { look: "kodak_2383" as const, intensity: 0.8, grain: 0.3, halation: 0.2, vignette: 0.2, chromatic: 0.1, gateWeave: 0.1, streak: 0 };

const shot = (over: Partial<ShotSpec> = {}): ShotSpec => ({
  kind: "shot",
  prompt: "@Mira walks through a rain-soaked market at night",
  cast: [],
  size: "medium",
  angle: "eye",
  lens: 35,
  move: "push_in",
  intensity: 1,
  cameraMode: "prompt",
  rigStyle: "subject",
  lighting: "neon",
  film,
  filmOnGpu: false,
  aspect: "16:9",
  quality: "draft",
  duration: 5,
  seed: 42,
  turbo: true,
  smooth: false,
  sound: true,
  ...over,
});

const cases: [string, JobSpec, ObjectInfo][] = [
  ["text-to-video", shot(), withoutPack],
  ["first + last frame", shot({ startFrame: img("start.png"), endFrame: img("end.png") }), withoutPack],
  ["cast references", shot({ cast: [img("cast_a.png", "Mira"), img("cast_b.png")] }), withoutPack],
  [
    "ghost rig + film lab + smooth + master",
    shot({ cameraMode: "rig", filmOnGpu: true, smooth: true, quality: "master", cast: [img("cast_a.png")], startFrame: img("start.png") }),
    withPack,
  ],
  ["extend", shot({ extend: { fromJob: "x", tail: vid("tail.mp4", 22), overlapFrames: 22 } }), withoutPack],
  ["previs clip", shot({ cameraMode: "rig", previs: { clip: vid("previs.mp4", 120), follow: "action" } }), withPack],
  ["recast", { kind: "recast", source: vid("test.mp4", 130), character: img("cast_a.png"), extras: [], notes: "", audio: "original", quality: "studio", seed: 1 }, withoutPack],
  ["restyle", { kind: "restyle", source: vid("test.mp4", 130), styleRef: img("ref.png"), style: "claymation", film, filmOnGpu: true, audio: "generated", quality: "draft", seed: 1 }, withPack],
  [
    "replace",
    { kind: "replace", source: vid("test.mp4", 81, 832, 480, 16), shape: "ellipse", keys: [{ f: 0, x: 0.4, y: 0.3, w: 0.2, h: 0.4 }], replacement: img("ref.png"), prompt: "a golden retriever", seed: 3 },
    withPack,
  ],
  ["motion paths", { kind: "paths", image: img("start.png"), paths: [[{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.4 }]], prompt: "a paper boat drifts", aspect: "16:9", seed: 9 }, withoutPack],
];

describe("compiled graphs validate against the home server's node list", () => {
  for (const [name, spec, info] of cases) {
    it(name, () => {
      const caps = detectCapabilities(info);
      const { graph, meta } = compile(spec, caps);
      expect(validateGraph(graph, info)).toEqual([]);
      expect(meta.frames).toBeGreaterThan(0);
    });
  }

  it("a previs clip drives the camera in place of the ghost rig", () => {
    const caps = detectCapabilities(withPack);
    const withClip = (follow: "camera" | "action") => compile(shot({ cameraMode: "rig", previs: { clip: { ...vid("previs.mp4", 120), url: "/p.mp4" }, follow } }), caps);
    const { graph, meta } = withClip("camera");
    const types = Object.values(graph).map((n) => (n as { class_type: string }).class_type);
    expect(types).not.toContain("NovaGhostRig");
    expect(types).toContain("LoadVideo");
    expect(meta.engine).toContain("previs clip");
    expect(meta.prompt).toContain("follow the previs <Video 1> exactly");
    expect(meta.prompt).toContain("Only its camera movement matters");
    expect(meta.prompt).not.toContain("push-in"); // the preset move is set aside
    expect(meta.notes).not.toContain(RIG_OFF_NOTE);
    expect(meta.cameraPath).toBeUndefined();
    expect(meta.previs).toBe("/p.mp4");
    expect(withClip("action").meta.prompt).toContain("placed and move exactly as in <Video 1>");
  });

  it("a recast direction may change the scene, and without one the background is kept", () => {
    const recast = (notes: string) => compile({ kind: "recast", source: vid("test.mp4", 130), character: img("cast_a.png"), extras: [], notes, audio: "original", quality: "draft", seed: 1 }, detectCapabilities(withoutPack)).meta.prompt;
    const plain = recast("");
    expect(plain).toContain("framing and background");
    expect(plain).toContain("Only the person changes");
    const night = recast("make it night ");
    expect(night).not.toContain("background.");
    expect(night).not.toContain("Only the person changes");
    expect(night).toContain("Direction: make it night. Follow it even where it changes the lighting, time of day, weather, setting or background");
  });

  it("uses the pack nodes only when the pack is installed", () => {
    const spec = shot({ cameraMode: "rig", filmOnGpu: true });
    const plain = JSON.stringify(compile(spec, detectCapabilities(withoutPack)).graph);
    const packed = JSON.stringify(compile(spec, detectCapabilities(withPack)).graph);
    expect(plain).not.toContain("NovaGhostRig");
    expect(packed).toContain("NovaGhostRig");
    expect(packed).toContain("NovaLensFilm");
  });

  it("a hand-drawn rig with stand-ins reaches the ghost rig node and the prompt", () => {
    const rig = {
      keys: [
        { t: 0, pos: [-2, 1.5, 3] as [number, number, number], target: [0, 1.3, 0] as [number, number, number], fov: 38, roll: 0 },
        { t: 1, pos: [2.5, 1.5, 2] as [number, number, number], target: [2, 1.3, -1] as [number, number, number], fov: 38, roll: 0 },
      ],
      ease: "inOutSine" as const,
      actors: [{ from: [-2, 0] as [number, number], to: [2.5, -1] as [number, number], height: 1.75 }],
      follow: { actor: 0, height: 1.4, amount: 0.9 },
    };
    const { graph, meta } = compile(shot({ cameraMode: "rig", rig, shake: 0.4 }), detectCapabilities(withPack));
    expect(validateGraph(graph, withPack)).toEqual([]);
    const node = Object.values(graph).find((n) => n.class_type === "NovaGhostRig")!;
    const sent = JSON.parse(String(node.inputs.camera_path));
    expect(sent.actors).toHaveLength(1);
    expect(sent.follow.actor).toBe(0);
    expect(sent.shake.amount).toBe(0.4);
    expect(meta.engine).toContain("custom");
    expect(meta.prompt).toMatch(/walks across the frame from left to right/);
    expect(meta.prompt).toMatch(/stand-in figures/);
  });

  it("stacked moves reach the ghost rig as one path and read as a sequence", () => {
    const combo = [
      { id: "push_in", intensity: 1, when: "whole" as const },
      { id: "pan_left", intensity: 0.8, when: "end" as const },
    ];
    const { graph, meta } = compile(shot({ cameraMode: "rig", combo }), detectCapabilities(withPack));
    expect(validateGraph(graph, withPack)).toEqual([]);
    const rig = Object.values(graph).find((n) => n.class_type === "NovaGhostRig")!;
    expect(JSON.parse(String(rig.inputs.camera_path)).keys.length).toBeGreaterThan(10);
    expect(meta.prompt).toMatch(/push-in toward the subject; then smooth pan to the left/);
  });

  it("skips the guide video when nothing moves", () => {
    const { graph } = compile(shot({ cameraMode: "rig", move: "locked" }), detectCapabilities(withPack));
    expect(JSON.stringify(graph)).not.toContain("NovaGhostRig");
  });

  it("accepts files uploaded after the node list was read", () => {
    const { graph } = compile(shot({ startFrame: img("just_uploaded.png") }), detectCapabilities(withoutPack));
    expect(validateGraph(graph, withoutPack)).toEqual([]);
  });

  it("catches a missing model with a readable message", () => {
    const { graph } = compile(shot(), detectCapabilities(withoutPack));
    const broken = structuredClone(graph);
    const unet = Object.values(broken).find((n) => n.class_type === "UNETLoader")!;
    unet.inputs.unet_name = "nope.safetensors";
    const issues = validateGraph(broken, withoutPack);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/not available on the server/);
  });
});

describe("sizing", () => {
  it("snaps to the 17k+5 grid like the workflows", () => {
    expect(h3Frames(5)).toBe(124);
    expect(h3Frames(10)).toBe(243);
    expect(h3FramesAtMost(130)).toBe(124);
    expect(h3FramesAtMost(124)).toBe(124);
  });
  it("keeps 1080p under the H3 length limit", () => {
    const p = planH3("16:9", "master", 10);
    expect(p.width * p.height * p.frames).toBeLessThanOrEqual(330_000_000);
    expect(p.clamped).toBe(true);
  });
});

describe("prompt", () => {
  it("swaps @mentions for picture tags and never leaks names", () => {
    const out = resolveMentions("@Mira hands @2 a lantern", [img("a", "Mira"), img("b")]);
    expect(out).toBe("<Picture 1> hands <Picture 2> a lantern");
  });

  it("treats a library asset's pictures as one subject and adds its description once", () => {
    const mira = (n: string): Asset => ({ ...img(n, "Mira"), group: "a1", note: "a woman in her 30s with a silver bob and a red raincoat" });
    const cast = [mira("m1.png"), mira("m2.png"), mira("m3.png"), img("lantern.png", "Lantern")];
    expect(resolveMentions("@Mira lifts the lantern; @Mira smiles", cast)).toBe(
      "<Picture 1> (a woman in her 30s with a silver bob and a red raincoat) lifts the lantern; <Picture 1> smiles",
    );
    expect(resolveMentions("@Mira waves", cast, true)).toBe("Mira (a woman in her 30s with a silver bob and a red raincoat) waves");

    const prompt = composeShotPrompt(shot({ prompt: "@Mira walks to camera", cast }), { startFrame: false });
    expect(prompt).toContain("<Picture 1>, <Picture 2> and <Picture 3> all show the same subject");
    // Mira is mentioned, so only the lantern is "featured" — and only once.
    expect(prompt).toContain("Featuring <Picture 4>, kept exactly");
    expect(prompt).not.toContain("Featuring <Picture 2>");
  });
});

describe("ghost rig switched off", () => {
  it("warns when a moving shot goes out as words only, not when nothing moves", () => {
    const caps = detectCapabilities(withPack);
    expect(compile(shot({ cameraMode: "prompt", move: "spiral_down" }), caps).meta.notes).toContain(RIG_OFF_NOTE);
    expect(compile(shot({ cameraMode: "prompt", move: "locked" }), caps).meta.notes).not.toContain(RIG_OFF_NOTE);
    expect(compile(shot({ cameraMode: "rig", move: "spiral_down" }), caps).meta.notes).not.toContain(RIG_OFF_NOTE);
  });
});

describe("switched-off sections", () => {
  const caps = detectCapabilities(withPack);
  it("leave their direction out of the prompt and their nodes out of the graph", () => {
    const on = compile(shot({ cameraMode: "rig", filmOnGpu: true }), caps);
    const types = (c: typeof on) => Object.values(c.graph).map((n) => n.class_type);
    expect(on.meta.prompt).toMatch(/Cinematography:.*Camera:.*Lighting:.*Look:/);
    expect(types(on)).toEqual(expect.arrayContaining(["NovaGhostRig", "NovaLensFilm"]));

    const off = compile(shot({ cameraMode: "rig", filmOnGpu: true, off: { framing: true, move: true, light: true, film: true } }), caps);
    expect(off.meta.prompt).not.toMatch(/Cinematography:|Camera:|Lighting:|Look:/);
    expect(off.meta.prompt).toContain("walks through a rain-soaked market");
    expect(types(off)).not.toContain("NovaGhostRig");
    expect(types(off)).not.toContain("NovaLensFilm");
  });
});

describe("film stocks on an older NovaField pack", () => {
  const caps = detectCapabilities(withPack);
  it("reads which looks and controls the server's node has", () => {
    expect(caps.pack.filmLooks).toContain("kodak_2383");
    expect(caps.pack.filmLooks).not.toContain("kodak_portra_400");
    expect(caps.pack.filmControls).toBe(false);
  });

  it("describes a newer stock in the prompt instead of failing the render", () => {
    const portra = compile(shot({ filmOnGpu: true, film: { ...film, look: "kodak_portra_400" } }), caps);
    expect(Object.values(portra.graph).map((n) => n.class_type)).not.toContain("NovaLensFilm");
    expect(portra.meta.notes).toContain(NEWER_STOCK_NOTE);
    expect(portra.meta.prompt).toMatch(/Portra 400/);
  });
});

describe("motion paths", () => {
  it("resamples a path to every frame, ending on the last point", () => {
    const pts = resamplePath([{ x: 0, y: 0 }, { x: 1, y: 0 }], 81, 832, 480);
    expect(pts).toHaveLength(81);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[80]).toEqual({ x: 832, y: 0 });
  });
});

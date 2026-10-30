import { describe, expect, it } from "vitest";
import { DEFAULT_GRADE } from "../cinema/grade";
import { titleFor } from "../jobs";
import { NO_CAPABILITIES } from "./capabilities";
import { blocker, compile } from "./index";
import type { GradeSpec } from "./specs";

const caps = { ...NO_CAPABILITIES, pack: { ...NO_CAPABILITIES.pack, lensFilm: true } };
const spec: GradeSpec = {
  kind: "grade",
  source: { name: "nf_clip.mp4", kind: "video", url: "/c.mp4", width: 1280, height: 720, fps: 24, frames: 120, duration: 5, label: "Alley push" },
  film: { ...DEFAULT_GRADE, look: "noir" },
  from: "vid1",
  seed: 9,
};

describe("grading a finished clip", () => {
  it("runs the frames through NovaLensFilm and keeps the clip's frame rate and sound", () => {
    const { graph, meta } = compile(spec, caps);
    const byClass = (c: string) => Object.entries(graph).find(([, n]) => n.class_type === c)!;
    const [partsId] = byClass("GetVideoComponents");
    const [filmId, film] = byClass("NovaLensFilm");
    expect(film.inputs).toMatchObject({ look: "noir", intensity: 0.8, images: [partsId, 0], seed: 9 });
    expect(byClass("CreateVideo")[1].inputs).toEqual(expect.objectContaining({ images: [filmId, 0], audio: [partsId, 1], fps: [partsId, 2] }));
    expect(byClass("LoadVideo")[1].inputs.file).toBe("nf_clip.mp4");
    expect(meta).toMatchObject({ engine: "NovaLensFilm", output: "video", width: 1280, height: 720, frames: 120, seconds: 5 });
  });

  it("needs the NovaField nodes, a clip and a grade that changes something", () => {
    expect(blocker(spec, caps)).toBeNull();
    expect(blocker(spec, NO_CAPABILITIES)).toMatch(/NovaField nodes/);
    expect(blocker({ ...spec, film: { ...spec.film, look: "none", grain: 0, halation: 0, vignette: 0 } }, caps)).toMatch(/changes nothing/);
  });

  it("sends the colour controls only to a server whose node has them", () => {
    const film = { ...spec.film, exposure: 0.5, temperature: -0.3, grainSize: 2 };
    const node = (c: typeof caps) => Object.values(compile({ ...spec, film }, c).graph).find((n) => n.class_type === "NovaLensFilm")!.inputs;
    const newer = { ...caps, pack: { ...caps.pack, filmControls: true, filmLooks: ["none", "noir", "kodak_portra_400"] } };
    expect(node(newer)).toMatchObject({ exposure: 0.5, temperature: -0.3, tint: 0, fade: 0, grain_size: 2 });
    expect(node(caps)).not.toHaveProperty("exposure");
    // On the older node those controls can't run, so the grade says how to get them.
    expect(blocker({ ...spec, film }, caps)).toMatch(/colour controls and grain size need NovaField nodes 0\.3\.0/);
    expect(blocker({ ...spec, film }, newer)).toBeNull();
  });

  it("asks for the updated nodes before grading with a newer stock", () => {
    const portra = { ...spec, film: { ...spec.film, look: "kodak_portra_400" as const } };
    expect(blocker(portra, caps)).toMatch(/film stock needs NovaField nodes 0\.3\.0/);
    expect(blocker(portra, { ...caps, pack: { ...caps.pack, filmLooks: ["none", "kodak_portra_400"] } })).toBeNull();
  });

  it("names the take after the look and the clip", () => {
    expect(titleFor(spec)).toBe("Grade: Noir, Alley push");
  });
});

describe("finishing a clip: continuity and motion", () => {
  const full = { ...caps, interpolate: true, pack: { ...caps.pack, matchColor: true, shutter: true } };
  const reference = { name: "nf_ref.png", kind: "image" as const, url: "/r.png" };
  const classes = (s: GradeSpec) => Object.values(compile(s, full).graph).map((n) => n.class_type);

  it("blurs, then matches, then adds the look, in that order", () => {
    const s: GradeSpec = { ...spec, match: { reference, amount: 0.8, colourOnly: true }, motion: { shutter: 180, speed: 1 } };
    const order = classes(s).filter((c) => ["FrameInterpolate", "NovaShutter", "NovaMatchColor", "NovaLensFilm"].includes(c));
    expect(order).toEqual(["FrameInterpolate", "NovaShutter", "NovaMatchColor", "NovaLensFilm"]);
    const { graph, meta } = compile(s, full);
    expect(meta.engine).toBe("NovaShutter + NovaMatchColor + NovaLensFilm");
    const node = (c: string) => Object.values(graph).find((n) => n.class_type === c)!;
    expect(node("NovaMatchColor").inputs).toMatchObject({ amount: 0.8, colour_only: true });
    expect(node("NovaShutter").inputs).toMatchObject({ multiplier: node("FrameInterpolate").inputs.multiplier, shutter_angle: 180, speed: 1 });
    expect(node("CreateVideo").inputs.audio).toBeDefined();
  });

  it("changes the length with the speed, drops the sound, and skips the look when there is none", () => {
    const s: GradeSpec = { ...spec, film: { ...spec.film, look: "none", grain: 0, halation: 0, vignette: 0 }, motion: { shutter: 0, speed: 0.5 } };
    const { graph, meta } = compile(s, full);
    expect(meta.frames).toBe(239);
    expect(meta.notes.join()).toMatch(/sound is left out/);
    expect(Object.values(graph).find((n) => n.class_type === "CreateVideo")!.inputs.audio).toBeUndefined();
    expect(classes(s)).not.toContain("NovaLensFilm");
    expect(meta.engine).toBe("NovaShutter");
    expect(titleFor(s)).toBe("Grade: 0.5× speed, Alley push");
  });

  it("asks for the updated nodes, or frame interpolation, when the server lacks them", () => {
    const s: GradeSpec = { ...spec, match: { reference, amount: 1, colourOnly: false } };
    expect(blocker(s, caps)).toMatch(/0\.4\.0/);
    const blurred: GradeSpec = { ...spec, motion: { shutter: 180, speed: 1 } };
    expect(blocker(blurred, { ...full, interpolate: false })).toMatch(/FILM frame interpolation/);
    expect(blocker(blurred, full)).toBeNull();
  });

  it("makes fewer in-between frames for big clips, but never too few to blur", () => {
    const multiplier = (w: number, h: number, frames: number) =>
      Object.values(compile({ ...spec, source: { ...spec.source, width: w, height: h, frames }, motion: { shutter: 180, speed: 1 } }, full).graph).find((n) => n.class_type === "FrameInterpolate")!.inputs.multiplier;
    expect(multiplier(864, 480, 124)).toBe(6);
    expect(multiplier(1280, 720, 120)).toBe(4);
    expect(multiplier(1920, 1080, 156)).toBe(2);
  });
});

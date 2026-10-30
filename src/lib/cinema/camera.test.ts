import { describe, expect, it } from "vitest";
import fixtures from "../../../comfyui-novafield/tests/fixtures/camera_cases.json";
import { actorPositions, basis, poseAt, project, propCorners, type CameraPath, type Vec3 } from "./camera";
import { buildPath, composePath, describeLayers, MOVES } from "./moves";

// The Python node pack writes these fixtures; the app's previs must land on the same pixels.
describe("camera math matches NovaGhostRig", () => {
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const path = c.path as unknown as CameraPath;
      for (const s of c.samples) {
        const pose = poseAt(path, s.frame);
        pose.pos.forEach((v, i) => expect(v).toBeCloseTo(s.pos[i], 6));
        pose.target.forEach((v, i) => expect(v).toBeCloseTo(s.target[i], 6));
        expect(pose.fov).toBeCloseTo(s.fov, 6);
        expect(pose.roll).toBeCloseTo(s.roll, 6);
        const px = project(basis(pose), fixtures.point as Vec3, fixtures.width, fixtures.height)!;
        expect(px[0]).toBeCloseTo(s.pixel[0], 4);
        expect(px[1]).toBeCloseTo(s.pixel[1], 4);
        const actors = (s as { actors?: number[][] }).actors;
        if (actors) actorPositions(path, s.frame).forEach((a, i) => a.forEach((v, j) => expect(v).toBeCloseTo(actors[i][j], 6)));
      }
      const corners = (c as { prop_corners?: number[][][] }).prop_corners;
      if (corners) (path.props ?? []).forEach((p, i) => propCorners(p).forEach((pt, k) => pt.forEach((v, j) => expect(v).toBeCloseTo(corners[i][k][j], 9))));
    });
  }
});

it("covers the walk-and-follow and set-piece cases", () => expect(fixtures.cases.map((c) => c.name)).toEqual(expect.arrayContaining(["follow_walk", "timed_walk_props"])));

describe("moves", () => {
  it("every move keeps the subject in front of the camera", () => {
    for (const m of MOVES) {
      const path = buildPath(m.id, { size: "medium", angle: "eye", lens: 35, intensity: 1, frames: 124, fps: 24 });
      for (const f of [0, 61, 123]) {
        const p = project(basis(poseAt(path, f)), [0, 1.2, 0], 864, 480);
        if (["whip_pan", "whip_pan_left", "fpv_dive", "pan_left", "pan_right", "bullet_time"].includes(m.id)) continue;
        expect(p, `${m.id} frame ${f}`).not.toBeNull();
      }
    }
  });
});

describe("composable moves", () => {
  const ctx = { size: "medium", angle: "eye", lens: 35, intensity: 1, frames: 124, fps: 24 } as const;
  const at = (path: ReturnType<typeof buildPath>, f: number) => poseAt(path, f);

  it("has a wide library, every move producing a valid path", () => {
    expect(MOVES.length).toBeGreaterThanOrEqual(30);
    for (const m of MOVES) {
      const p = buildPath(m.id, ctx);
      for (const f of [0, 62, 123]) for (const v of [...at(p, f).pos, ...at(p, f).target, at(p, f).fov]) expect(Number.isFinite(v), m.id).toBe(true);
    }
  });

  it("pans and arcs the way their names say", () => {
    // The camera starts at +z looking toward -z, so screen-left is -x.
    const left = buildPath("pan_left", ctx);
    const right = buildPath("pan_right", ctx);
    expect(at(left, 123).target[0]).toBeLessThan(at(left, 0).target[0]);
    expect(at(right, 123).target[0]).toBeGreaterThan(at(right, 0).target[0]);
    expect(at(buildPath("orbit_right", ctx), 123).pos[0]).toBeGreaterThan(0.5);
    expect(at(buildPath("orbit_left", ctx), 123).pos[0]).toBeLessThan(-0.5);
  });

  it("stacks moves, and a 'then' layer waits for the second half", () => {
    const p = composePath(
      [
        { id: "push_in", intensity: 1, when: "whole" },
        { id: "pan_left", intensity: 1, when: "end" },
      ],
      ctx,
    );
    // Heading in degrees: 0 = straight down -z, positive = turned right.
    const yaw = (f: number) => {
      const q = at(p, f);
      return (Math.atan2(q.target[0] - q.pos[0], -(q.target[2] - q.pos[2])) * 180) / Math.PI;
    };
    expect(Math.abs(yaw(55) - yaw(0))).toBeLessThan(0.5); // no pan in the first half
    expect(yaw(123)).toBeLessThan(yaw(55) - 30); // pans left in the second
    expect(at(p, 123).pos[2]).toBeLessThan(at(p, 0).pos[2] - 0.5); // pushes in throughout
  });

  it("keeps the subject the same size through a dolly zoom", () => {
    const p = buildPath("dolly_zoom", ctx);
    const height = (f: number) => {
      const b = basis(at(p, f));
      const top = project(b, [0, 1.75, 0], 864, 480)!;
      const foot = project(b, [0, 0, 0], 864, 480)!;
      return foot[1] - top[1];
    };
    expect(height(123) / height(0)).toBeGreaterThan(0.9);
    expect(height(123) / height(0)).toBeLessThan(1.1);
  });

  it("drone, glide and roll moves go where their names say", () => {
    const rise = at(buildPath("overhead_rise", ctx), 123);
    expect(rise.pos[1] - rise.target[1]).toBeGreaterThan(4 * Math.hypot(rise.pos[0] - rise.target[0], rise.pos[2] - rise.target[2])); // nearly top-down
    const glide = buildPath("ground_glide", ctx);
    expect(at(glide, 0).pos[1]).toBeLessThan(0.4);
    expect(at(glide, 123).pos[2]).toBeLessThan(at(glide, 0).pos[2]);
    expect(at(buildPath("barrel_roll", ctx), 123).roll).toBeCloseTo(360);
    const full = buildPath("full_orbit", ctx);
    expect(at(full, 123).pos[2]).toBeCloseTo(at(full, 0).pos[2]); // back where it started
    expect(buildPath("earthquake", ctx).shake?.amount).toBe(1);
  });

  it("describes a stack for the prompt", () => {
    const text = describeLayers([
      { id: "push_in", intensity: 1, when: "whole" },
      { id: "crane_up", intensity: 1, when: "end" },
    ]);
    expect(text).toBe("slow dolly push-in toward the subject; then crane shot rising up and over the subject");
  });
});

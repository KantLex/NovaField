import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shotPath } from "./custom";
import { exportRig, parseRigFile, type RigFile } from "./rigFile";

const ok = (text: string): RigFile => {
  const r = parseRigFile(text);
  if ("error" in r) throw new Error(r.error);
  return r;
};
const err = (v: unknown) => {
  const r = parseRigFile(typeof v === "string" ? v : JSON.stringify(v));
  return "error" in r ? r.error : "";
};

describe("camera path files", () => {
  it("reads the street-walk sample: keys, a walking stand-in it follows, and set pieces", () => {
    const r = ok(readFileSync(path.join(__dirname, "../../../samples/camera-street-walk.json"), "utf8"));
    expect(r.name).toBe("Street walk: arc and push in");
    expect(r.seconds).toBe(6);
    expect(r.rig.keys).toHaveLength(9);
    expect(r.rig.actors[0].to).toEqual([0, 3.2]);
    expect(r.rig.follow?.actor).toBe(0);
    expect(r.rig.props).toHaveLength(8);
  });

  it("reads the contract's own example and a bare list of keys without times", () => {
    const contract = ok(
      JSON.stringify({
        version: 1,
        frames: 124,
        fps: 24,
        ease: "inOutCubic",
        keys: [
          { t: 0, pos: [0, 1.5, 4], target: [0, 1.4, 0], fov: 40, roll: 0 },
          { t: 1, pos: [0, 1.5, 2.2], target: [0, 1.4, 0], fov: 40, roll: 0 },
        ],
      }),
    );
    expect(contract.rig.ease).toBe("inOutCubic");
    expect(contract.seconds).toBeCloseTo(124 / 24);
    const bare = ok(JSON.stringify({ camera_path: { keys: [{ pos: [0, 1, 5], target: [0, 1, 0] }, { pos: [2, 1, 4], target: [0, 1, 0] }, { pos: [4, 1, 0], target: [0, 1, 0] }] } }));
    expect(bare.rig.keys.map((k) => k.t)).toEqual([0, 0.5, 1]);
    expect(bare.rig.keys[0].fov).toBe(40);
    // One key is a locked-off shot.
    expect(ok(JSON.stringify({ keys: [{ pos: [0, 1, 5], target: [0, 1, 0] }] })).rig.keys).toHaveLength(2);
  });

  it("round-trips a NovaField export", () => {
    const rig = ok(readFileSync(path.join(__dirname, "../../../samples/camera-street-walk.json"), "utf8")).rig;
    const p = shotPath({ move: "locked", rig, size: "medium", angle: "eye", lens: 35, intensity: 1, frames: 144, fps: 24 });
    const back = ok(exportRig(p, "Again"));
    expect(back.name).toBe("Again");
    expect(back.rig.keys).toEqual(rig.keys);
    expect(back.rig.props).toEqual(rig.props);
  });

  it("says what's wrong, in words", () => {
    expect(err("{ nope")).toMatch(/isn't valid JSON/);
    expect(err({ keys: [] })).toMatch(/needs "keys"/);
    expect(err({ keys: [{ pos: [0, 1], target: [0, 1, 0] }] })).toMatch(/key 1: pos needs three numbers/);
    expect(err({ keys: [{ pos: [0, 1, 0], target: [0, 1, 0] }] })).toMatch(/looks nowhere/);
    expect(err({ keys: [{ pos: [0, 1, 5], target: [0, 1, 0] }], ease: "bouncy" })).toMatch(/"ease" must be one of/);
    expect(err({ keys: [{ pos: [0, 1, 5000], target: [0, 1, 0] }] })).toMatch(/metres/);
    expect(err({ keys: [{ pos: [0, 1, 5], target: [0, 1, 0] }], follow: { actor: 2 } })).toMatch(/follow" points at actor 3/);
  });

  it("keeps an empty stand-in list through export and import", () => {
    const rig = (text: string) => {
      const r = parseRigFile(text);
      if ("error" in r) throw new Error(r.error);
      return r.rig;
    };
    expect(rig(JSON.stringify({ keys: [{ pos: [0, 1, 5], target: [0, 1, 0] }], actors: [] })).actors).toEqual([]);
    expect(rig(JSON.stringify({ keys: [{ pos: [0, 1, 5], target: [0, 1, 0] }] })).actors).toHaveLength(1);
  });
});

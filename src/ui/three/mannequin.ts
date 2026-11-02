// A stand-in person for the 3D plan, 1.75 m tall and facing +z: a figure of softly rounded blocks
// with a visor across its face, a shirt in its stand-in colour, dark trousers and boots. Arms
// bend at the elbow, legs at the knee and the head turns, so it can walk or run between its marks,
// or wave, talk, point, look around, sit, jump or dance on the spot.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Motion } from "@/lib/cinema/camera";

export interface Mannequin {
  group: THREE.Group;
  /**
   * Pose it. `t` is the shot time in seconds (motions on the spot loop on it); `phase` is the
   * stride in radians (one stride per 2π) and `swing` 0 standing to 1 under way, for a gait.
   */
  pose: (motion: Motion, t: number, phase: number, swing: number) => void;
  dispose: () => void;
}

const TRIM = { pelvis: "#263b46", trousers: "#334854", boots: "#1f303b", visor: "#162e3a", skin: "#bdc9c5", hands: "#d1dad2" };
/** The figure is modelled 1.84 m tall, then scaled to a 1.75 m stand-in. */
const MODEL_HEIGHT = 1.84;
/** Metres travelled per stride cycle, by gait: how fast the legs turn over. */
export const STRIDE: Record<string, number> = { walk: 1.3, run: 2.2 };

export function mannequin(color: string): Mannequin {
  const geometries: THREE.BufferGeometry[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (c: string) => {
    let m = materials.get(c);
    if (!m) materials.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0.12 })));
    return m;
  };
  /** A rounded block [w, h, d] centred at [x, y, z]. */
  const block = (size: [number, number, number], at: [number, number, number], c: string) => {
    const g = new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(...size) * 0.14);
    geometries.push(g);
    const m = new THREE.Mesh(g, material(c));
    m.position.set(...at);
    return m;
  };
  const joint = (x: number, y: number, ...parts: THREE.Object3D[]) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    g.add(...parts);
    return g;
  };

  const root = new THREE.Group();
  // The head turns at the neck.
  const head = joint(0, 1.48, block([0.11, 0.08, 0.11], [0, 0, 0], TRIM.skin), block([0.32, 0.34, 0.3], [0, 0.19, 0], color), block([0.27, 0.1, 0.05], [0, 0.22, 0.155], TRIM.visor));
  root.add(block([0.49, 0.55, 0.29], [0, 1.18, 0], color), block([0.42, 0.23, 0.27], [0, 0.81, 0], TRIM.pelvis), head);

  // Index 0 is the figure's right side (-x, as it faces +z), 1 its left.
  const SIDES = [-1, 1];
  const arms = SIDES.map((side) => {
    const fore = joint(0, -0.32, block([0.15, 0.29, 0.16], [0, -0.13, 0], color), block([0.15, 0.17, 0.08], [0, -0.33, 0], TRIM.hands));
    const arm = joint(side * 0.33, 1.4, block([0.17, 0.32, 0.18], [0, -0.15, 0], color), fore);
    root.add(arm);
    return { arm, fore };
  });
  const legs = SIDES.map((side) => {
    const shin = joint(0, -0.35, block([0.17, 0.32, 0.18], [0, -0.16, 0], TRIM.trousers), block([0.21, 0.1, 0.31], [0, -0.36, 0.05], TRIM.boots));
    const leg = joint(side * 0.12, 0.76, block([0.19, 0.36, 0.21], [0, -0.17, 0], TRIM.trousers), shin);
    root.add(leg);
    return { leg, shin };
  });

  const body = new THREE.Group();
  body.scale.setScalar(1.75 / MODEL_HEIGHT);
  body.add(root);
  const group = new THREE.Group();
  group.add(body);

  // Rotations: a positive x swings a hanging limb back (and bends a knee); a negative x swings it
  // forward. An arm's z of side × angle raises it out to its side. Root x leans forward.
  const rest = () => {
    for (const j of [...arms.flatMap((a) => [a.arm, a.fore]), ...legs.flatMap((l) => [l.leg, l.shin]), head]) j.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    arms.forEach(({ arm }, i) => (arm.rotation.z = SIDES[i] * 0.06));
  };

  /** The lowest a foot reaches below the hip, for a thigh at angle `a` and a knee bent by `k`. */
  const footDrop = (a: number, k: number) => 0.35 * Math.cos(a) + 0.41 * Math.cos(a + k);

  /** Walking: legs and arms swing opposite, the knee bends as each leg passes behind, a foot always on the floor. */
  const walk = (phase: number, swing: number) => {
    const w = Math.sin(phase);
    const drops = legs.map(({ leg, shin }, i) => {
      const k = i === 0 ? w : -w;
      leg.rotation.x = k * 0.6 * swing;
      shin.rotation.x = Math.max(0, k) * 0.8 * swing;
      return footDrop(leg.rotation.x, shin.rotation.x);
    });
    arms.forEach(({ arm, fore }, i) => {
      arm.rotation.x = (i === 0 ? -w : w) * 0.7 * swing;
      fore.rotation.x = -0.12 - 0.45 * swing;
    });
    root.rotation.x = 0.03 * swing;
    // The body dips as the legs spread, as a real walk does: part way toward the lower foot
    // (a real foot reaches further, through the ankle and toes).
    root.position.y = (Math.max(...drops) - 0.76) * 0.4;
  };

  /**
   * Running: the leading thigh lifts with the shin hanging below the knee, the trailing heel kicks
   * up, elbows bent at the side. The body is lowest as the legs pass and rises into each stride.
   */
  const run = (phase: number, swing: number) => {
    const w = Math.sin(phase);
    legs.forEach(({ leg, shin }, i) => {
      const k = i === 0 ? w : -w;
      leg.rotation.x = -0.8 * k * swing;
      shin.rotation.x = (k > 0 ? 0.7 * k : 1.5 * -k) * swing;
    });
    arms.forEach(({ arm, fore }, i) => {
      arm.rotation.x = (i === 0 ? w : -w) * 0.85 * swing;
      fore.rotation.x = -0.2 - 1.2 * swing;
    });
    root.rotation.x = 0.16 * swing;
    root.position.y = Math.abs(w) * 0.07 * swing;
  };

  const onTheSpot = (kind: Motion, t: number) => {
    const breathe = Math.sin(t * 2);
    switch (kind) {
      case "wave": {
        arms[0].arm.rotation.z = -2.5;
        arms[0].fore.rotation.z = -0.25 - 0.35 * Math.sin(t * 9);
        head.rotation.z = 0.06;
        break;
      }
      case "talk":
        arms.forEach(({ arm, fore }, i) => {
          arm.rotation.x = -0.25 - 0.1 * Math.sin(t * 3 + i * 2);
          arm.rotation.z = SIDES[i] * (0.15 + 0.1 * Math.sin(t * 4 + i));
          fore.rotation.x = -1.15 + 0.3 * Math.sin(t * 4.5 + i * 1.7);
        });
        head.rotation.x = Math.sin(t * 3) * 0.06;
        head.rotation.y = Math.sin(t * 0.9) * 0.15;
        break;
      case "point":
        arms[0].arm.rotation.x = -1.5;
        arms[0].arm.rotation.z = 0;
        head.rotation.x = 0.05;
        break;
      case "look":
        head.rotation.y = Math.sin(t * 1.1) * 0.9;
        head.rotation.x = Math.sin(t * 0.7) * 0.1;
        break;
      case "sit":
        // Thighs level and shins down, feet on the floor: the hips drop by the shin's length.
        legs.forEach(({ leg, shin }) => {
          leg.rotation.x = -1.5;
          shin.rotation.x = 1.5;
        });
        root.position.y = -0.35;
        arms.forEach(({ arm, fore }) => {
          arm.rotation.x = -0.35;
          fore.rotation.x = -0.75;
        });
        break;
      case "jump": {
        // Crouch, spring up, land, crouch: once every 1.4 s.
        const u = (t % 1.4) / 1.4;
        const air = u >= 0.3 && u <= 0.7 ? Math.sin(((u - 0.3) / 0.4) * Math.PI) : 0;
        const crouch = u < 0.3 ? Math.sin((u / 0.3) * Math.PI) : u > 0.7 ? Math.sin(((u - 0.7) / 0.3) * Math.PI) : 0;
        legs.forEach(({ leg, shin }) => {
          leg.rotation.x = -0.7 * crouch;
          shin.rotation.x = 1.3 * crouch;
        });
        arms.forEach(({ arm, fore }, i) => {
          arm.rotation.x = 0.6 * crouch;
          arm.rotation.z = SIDES[i] * (0.06 + 2.3 * air);
          fore.rotation.x = -0.2;
        });
        root.rotation.x = 0.2 * crouch;
        root.position.y = 0.4 * air - 0.18 * crouch;
        break;
      }
      case "dance": {
        const b = t * 4;
        root.position.y = Math.abs(Math.sin(b)) * 0.05;
        root.rotation.z = Math.sin(b / 2) * 0.08;
        arms.forEach(({ arm, fore }, i) => {
          arm.rotation.z = SIDES[i] * (1.2 + 0.9 * Math.sin(b + i * Math.PI));
          fore.rotation.x = -0.8;
        });
        legs.forEach(({ leg, shin }, i) => {
          const k = Math.sin(b + i * Math.PI);
          leg.rotation.x = -0.25 * Math.max(0, k);
          shin.rotation.x = 0.5 * Math.max(0, k);
        });
        head.rotation.z = Math.sin(b / 2) * 0.12;
        break;
      }
      default:
        // Standing: breathing, a slight sway of the arms and a glance now and then.
        root.position.y = breathe * 0.004;
        arms.forEach(({ arm }, i) => (arm.rotation.z = SIDES[i] * (0.06 + 0.015 * breathe)));
        head.rotation.y = Math.sin(t * 0.5) * 0.12;
    }
  };

  const pose = (motion: Motion, t: number, phase: number, swing: number) => {
    rest();
    const moving = motion === "walk" || motion === "run";
    if (moving && swing > 0.01) (motion === "run" ? run : walk)(phase, swing);
    else onTheSpot(moving ? "idle" : motion, t);
  };
  pose("idle", 0, 0, 0);

  return {
    group,
    pose,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials.values()) m.dispose();
    },
  };
}

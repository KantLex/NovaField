// Set pieces as what they are: a table on legs, a sofa with a back and arms, a car on wheels, a
// tree. Each fills the piece's box ([width, height, depth], standing on the floor, centred on its
// spot), so the plan's footprint and the box the ghost rig draws still match. Shapes the set
// doesn't know (a 3D take still loading, an old label) stay a plain block.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Vec3 } from "@/lib/cinema/camera";
import { setPiece, type SetPieceLabel } from "@/lib/cinema/setPieces";

export interface PieceMaterials {
  /** The set's clay. */
  clay: THREE.Material;
  /** Darker parts: a car's glass and tyres, a crate's slats. */
  dark: THREE.Material;
}

type Geo = <T extends THREE.BufferGeometry>(g: T) => T;

/**
 * The shape for a set piece called `label`, sized to `size`, or null for a plain block. `geo`
 * hands each geometry back to the caller, which disposes of it.
 */
export function pieceShape(label: string | undefined, size: Vec3, mat: PieceMaterials, geo: Geo): THREE.Group | null {
  const make = setPiece(label) ? SHAPES[label as SetPieceLabel] : undefined;
  if (!make) return null;
  const [w, h, d] = size;
  const g = new THREE.Group();
  /** A block from (x0, y0, z0) to (x1, y1, z1) in the piece's own frame. */
  const block = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m = mat.clay, round = 0) => {
    const sx = Math.max(0.01, x1 - x0);
    const sy = Math.max(0.01, y1 - y0);
    const sz = Math.max(0.01, z1 - z0);
    const r = Math.min(round, sx / 2, sy / 2, sz / 2);
    const mesh = new THREE.Mesh(geo(r > 0.004 ? new RoundedBoxGeometry(sx, sy, sz, 2, r) : new THREE.BoxGeometry(sx, sy, sz)), m);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.add(mesh);
    return mesh;
  };
  make({ w, h, d, block, g, mat, geo });
  return g;
}

interface Kit {
  w: number;
  h: number;
  d: number;
  block: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m?: THREE.Material, round?: number) => THREE.Mesh;
  g: THREE.Group;
  mat: PieceMaterials;
  geo: Geo;
}

/** Four legs under a top, set in from the corners. */
function legs({ w, d, block }: Kit, top: number, t: number, inset: number) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - inset - t / 2);
      const z = sz * (d / 2 - inset - t / 2);
      block(x - t / 2, 0, z - t / 2, x + t / 2, top, z + t / 2);
    }
}

/** A shape for every set piece in SET_PIECES, by its name. The back of a piece is -z. */
const SHAPES: Record<SetPieceLabel, (k: Kit) => void> = {
  Table: (k) => {
    const top = Math.min(0.05, k.h * 0.1);
    k.block(-k.w / 2, k.h - top, -k.d / 2, k.w / 2, k.h, k.d / 2, undefined, 0.012);
    legs(k, k.h - top, Math.min(0.07, k.w * 0.08), 0.05);
  },
  Counter: (k) => {
    const top = Math.min(0.045, k.h * 0.08);
    // A plinth set back at the toes, the cabinet, then a worktop that overhangs the front.
    k.block(-k.w / 2 + 0.02, 0, -k.d / 2, k.w / 2 - 0.02, 0.1, k.d / 2 - 0.07, k.mat.dark);
    k.block(-k.w / 2 + 0.02, 0.1, -k.d / 2, k.w / 2 - 0.02, k.h - top, k.d / 2 - 0.03);
    k.block(-k.w / 2, k.h - top, -k.d / 2, k.w / 2, k.h, k.d / 2, undefined, 0.01);
  },
  Sofa: (k) => {
    const { w, h, d, block } = k;
    const arm = Math.min(0.22, w * 0.12);
    const back = Math.min(0.24, d * 0.28);
    const seat = h * 0.5;
    block(-w / 2 + arm, 0.06, -d / 2 + back, w / 2 - arm, seat, d / 2, undefined, 0.05);
    block(-w / 2, 0.06, -d / 2, w / 2, h, -d / 2 + back, undefined, 0.06);
    for (const s of [-1, 1]) block(s > 0 ? w / 2 - arm : -w / 2, 0.06, -d / 2, s > 0 ? w / 2 : -w / 2 + arm, h * 0.72, d / 2, undefined, 0.06);
    block(-w / 2 + 0.05, 0, -d / 2 + 0.05, w / 2 - 0.05, 0.06, d / 2 - 0.05, k.mat.dark);
  },
  Bed: (k) => {
    const { w, h, d, block } = k;
    const head = Math.min(0.08, d * 0.05);
    block(-w / 2, 0.05, -d / 2 + head, w / 2, h * 0.5, d / 2, undefined, 0.02);
    block(-w / 2 + 0.03, h * 0.5, -d / 2 + head + 0.02, w / 2 - 0.03, h * 0.82, d / 2 - 0.02, undefined, 0.06);
    block(-w / 2, 0, -d / 2, w / 2, h, -d / 2 + head, undefined, 0.02);
    // Pillows at the head, a folded-back cover at the foot.
    const pw = Math.min(0.65, (w - 0.2) / 2);
    for (const s of w > 1.2 ? [-1, 1] : [0]) block(s * (pw / 2 + 0.04) - pw / 2, h * 0.82, -d / 2 + head + 0.06, s * (pw / 2 + 0.04) + pw / 2, Math.min(h, h * 0.82 + 0.12), -d / 2 + head + 0.46, undefined, 0.05);
    block(-w / 2 + 0.01, h * 0.5, d * 0.05, w / 2 - 0.01, h * 0.86, d / 2 - 0.01, k.mat.dark, 0.04);
  },
  Car: (k) => {
    const { w, h, d, block, g, mat, geo } = k;
    // Length runs along x, the front at +x.
    const r = Math.min(0.34, h * 0.24, w * 0.09);
    const sill = r * 0.7;
    const belt = h * 0.58;
    block(-w / 2, sill, -d / 2, w / 2, belt, d / 2, undefined, 0.12);
    // The glasshouse, set back from the bonnet, under a roof.
    const cab0 = -w * 0.3;
    const cab1 = w * 0.17;
    block(cab0, belt - 0.02, -d / 2 + 0.1, cab1, h - 0.06, d / 2 - 0.1, mat.dark, 0.08);
    block(cab0 + 0.08, h - 0.07, -d / 2 + 0.12, cab1 - 0.08, h, d / 2 - 0.12, undefined, 0.04);
    const tyre = geo(new THREE.CylinderGeometry(r, r, 0.22, 20));
    tyre.rotateX(Math.PI / 2);
    for (const x of [-w / 2 + w * 0.18, w / 2 - w * 0.18])
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(tyre, mat.dark);
        t.position.set(x, r, s * (d / 2 - 0.11));
        g.add(t);
      }
  },
  Wall: (k) => {
    k.block(-k.w / 2, 0, -k.d / 2, k.w / 2, k.h, k.d / 2);
    // A skirting board along the foot.
    k.block(-k.w / 2, 0, -k.d / 2 - 0.012, k.w / 2, Math.min(0.12, k.h * 0.05), k.d / 2 + 0.012, k.mat.dark);
  },
  "Door frame": (k) => {
    const { w, h, d, block } = k;
    const post = Math.min(0.1, w * 0.12);
    for (const s of [-1, 1]) block(s > 0 ? w / 2 - post : -w / 2, 0, -d / 2, s > 0 ? w / 2 : -w / 2 + post, h, d / 2);
    block(-w / 2, h - post, -d / 2, w / 2, h, d / 2);
  },
  Crate: (k) => {
    const { w, h, d, block, mat } = k;
    block(-w / 2 + 0.02, 0.02, -d / 2 + 0.02, w / 2 - 0.02, h - 0.02, d / 2 - 0.02);
    // Slats round every edge.
    const t = Math.min(0.07, w * 0.1);
    for (const y of [0, h - t]) {
      block(-w / 2, y, -d / 2, w / 2, y + t, -d / 2 + t, mat.dark);
      block(-w / 2, y, d / 2 - t, w / 2, y + t, d / 2, mat.dark);
      block(-w / 2, y, -d / 2, -w / 2 + t, y + t, d / 2, mat.dark);
      block(w / 2 - t, y, -d / 2, w / 2, y + t, d / 2, mat.dark);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(sx > 0 ? w / 2 - t : -w / 2, 0, sz > 0 ? d / 2 - t : -d / 2, sx > 0 ? w / 2 : -w / 2 + t, h, sz > 0 ? d / 2 : -d / 2 + t, mat.dark);
  },
  Chair: (k) => {
    const { w, h, d, block } = k;
    const seat = Math.min(0.46, h * 0.5);
    block(-w / 2, seat - 0.05, -d / 2, w / 2, seat, d / 2, undefined, 0.015);
    legs(k, seat - 0.05, Math.min(0.045, w * 0.1), 0.02);
    block(-w / 2, seat, -d / 2, w / 2, h, -d / 2 + Math.min(0.05, d * 0.1), undefined, 0.015);
  },
  Tree: (k) => {
    const { w, h, d, g, mat, geo } = k;
    const trunkTop = h * 0.5;
    const rt = Math.min(0.14, Math.min(w, d) * 0.08);
    const trunk = new THREE.Mesh(geo(new THREE.CylinderGeometry(rt * 0.75, rt, trunkTop, 10)), mat.dark);
    trunk.position.y = trunkTop / 2;
    g.add(trunk);
    // A crown of three soft blobs, together filling the top of the box.
    const blob = geo(new THREE.IcosahedronGeometry(1, 2));
    const crown = h - h * 0.32;
    for (const [x, y, z, s] of [
      [0, crown, 0, 1],
      [-0.28, crown - 0.12, 0.12, 0.7],
      [0.26, crown - 0.08, -0.14, 0.72],
    ] as const) {
      const m = new THREE.Mesh(blob, mat.clay);
      m.scale.set((w / 2) * s * 0.92, h * 0.32 * s, (d / 2) * s * 0.92);
      m.position.set(x * w * 0.5, y + (1 - s) * h * 0.1, z * d * 0.5);
      g.add(m);
    }
  },
  "Lamp post": (k) => {
    const { w, h, d, block, g, mat, geo } = k;
    const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.045, 0.07, h - 0.2, 10)), mat.dark);
    pole.position.y = (h - 0.2) / 2;
    g.add(pole);
    block(-0.11, 0, -0.11, 0.11, 0.3, 0.11, mat.dark, 0.02);
    block(-w / 2, h - 0.34, -d / 2, w / 2, h - 0.04, d / 2, undefined, 0.04);
    block(-w / 2 - 0.02, h - 0.06, -d / 2 - 0.02, w / 2 + 0.02, h, d / 2 + 0.02, mat.dark, 0.02);
  },
  Steps: (k) => {
    const { w, h, d, block } = k;
    // Rising toward the back (-z).
    const n = Math.max(2, Math.min(12, Math.round(h / 0.17)));
    for (let i = 0; i < n; i++) block(-w / 2, 0, -d / 2, w / 2, (h * (i + 1)) / n, d / 2 - (d * i) / n);
  },
};

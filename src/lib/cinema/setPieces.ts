// The set pieces to block a scene with, in one table: the name the plan shows, a real-world size
// ([width, height, depth] in metres) and how the prompt says it. The 3D set builds each one's
// shape by the same name (src/ui/three/setPieces.ts), typed so a name can't go missing there.

import type { Vec3 } from "./camera";

export const SET_PIECES = [
  { label: "Table", size: [1.6, 0.75, 0.9], words: "a table" },
  { label: "Counter", size: [2.4, 1.05, 0.6], words: "a counter" },
  { label: "Sofa", size: [2.1, 0.85, 0.9], words: "a sofa" },
  { label: "Bed", size: [1.6, 0.6, 2.1], words: "a bed" },
  { label: "Car", size: [4.5, 1.45, 1.8], words: "a car" },
  { label: "Wall", size: [4, 2.6, 0.15], words: "a wall" },
  { label: "Door frame", size: [1, 2.1, 0.15], words: "a doorway" },
  { label: "Crate", size: [0.8, 0.8, 0.8], words: "a crate" },
  { label: "Chair", size: [0.5, 0.9, 0.52], words: "a chair" },
  { label: "Steps", size: [1.4, 0.85, 1.5], words: "a short flight of steps" },
  { label: "Tree", size: [2.2, 4.5, 2.2], words: "a tree" },
  { label: "Lamp post", size: [0.36, 3.6, 0.36], words: "a street lamp" },
] as const satisfies readonly { label: string; size: Vec3; words: string }[];

export type SetPieceLabel = (typeof SET_PIECES)[number]["label"];

/** The set piece called `label`, if it's one of these (a 3D take's set piece is named after the take). */
export const setPiece = (label: string | undefined) => SET_PIECES.find((p) => p.label === label);

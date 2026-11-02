"use client";

// The 3D previs as H3's guide: for a shot going out with the "3D set" previs, this browser draws the
// set through the shot's camera and the server turns the frames into the reference video H3 follows.

import { isStill } from "@/lib/cinema/custom";
import { shotCameraPath } from "@/lib/engines/h3";
import { ASPECTS } from "@/lib/engines/sizing";
import type { Asset, ShotSpec } from "@/lib/engines/specs";
import { api } from "../api";

/** True when the shot's camera follows the 3D set: an H3 shot with previs on, a moving camera and no clip of your own. */
export function usesGuide(spec: ShotSpec): boolean {
  if (spec.engine || spec.cameraMode !== "rig" || spec.rigStyle !== "set3d" || spec.previs || spec.off?.move) return false;
  return !isStill(shotCameraPath(spec));
}

/** The guide video for a shot, or null when it doesn't use one. */
export async function guideFor(spec: ShotSpec, onProgress?: (pct: number) => void): Promise<Asset | null> {
  if (!usesGuide(spec)) return null;
  const path = shotCameraPath(spec);
  const ratio = ASPECTS.find((a) => a.id === spec.aspect)?.ratio ?? 16 / 9;
  const { guideFrames } = await import("../three/lensRender");
  return api.guide(await guideFrames(path, ratio, 480, onProgress), path.fps);
}

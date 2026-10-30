// Turn a file on disk into a ComfyUI-ready asset for a purpose: conform it to what the model
// expects and place it in ComfyUI's input folder. Used by uploads and by the asset library.
// purpose: "image" | "h3" (reference video at 24 fps) | "wan" (16 fps at the Wan working size)
//          | "raw" (any image, video or audio, uploaded untouched for an imported workflow)
//          | "track" (music for a film: checked and kept here, never sent to ComfyUI)

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "@/lib/engines/specs";
import { h3FramesAtMost, nearestAspect, planWan } from "@/lib/engines/sizing";
import { upload } from "./comfy";
import { DRY_RUN } from "./config";
import { conformForH3, conformForWan, dirs, ensureDirs, poster, probe } from "./media";

import type { Purpose } from "@/lib/assets";
import { say } from "@/lib/say";

export type { Purpose };

export class IngestError extends Error {}

/**
 * `original` is a file the app already has (an upload, or an asset's stored original); `fileName`
 * and `mime` are what the person gave it. `url` is how the browser shows that original.
 */
export async function ingest(original: string, fileName: string, mime: string, purpose: Purpose, url: string): Promise<Asset> {
  await ensureDirs();
  const uid = randomUUID().slice(0, 10);
  const ext = path.extname(original).toLowerCase();
  const file = { name: fileName, type: mime };
  if (purpose === "track") {
    const p = await probe(original).catch(() => null);
    if (!p?.hasAudio) throw new IngestError(say("That file has no sound to use as a soundtrack."));
    return { name: fileName, kind: "audio", url, duration: p.duration || undefined, label: labelFrom(fileName) };
  }
  if (purpose === "raw") {
    const p = await probe(original).catch(() => null);
    const kind: Asset["kind"] = file.type.startsWith("audio") || (p && !p.width) ? "audio" : file.type.startsWith("video") || (p && p.frames > 1 && p.duration > 0) ? "video" : "image";
    const name = DRY_RUN ? `nf_${uid}${ext}` : await upload(new Blob([await readFile(original)]), `nf_${uid}${ext}`);
    const asset: Asset = {
      name,
      kind,
      url,
      width: p?.width || undefined,
      height: p?.height || undefined,
      duration: p?.duration || undefined,
      fps: kind === "video" ? p?.fps : undefined,
      frames: kind === "video" ? p?.frames : undefined,
      label: labelFrom(file.name),
    };
    return asset;
  }

  if (purpose === "image") {
    const p = await probe(original);
    const name = DRY_RUN ? `nf_${uid}${ext}` : await upload(new Blob([await readFile(original)]), `nf_${uid}${ext}`);
    const asset: Asset = { name, kind: "image", url, width: p.width, height: p.height, label: labelFrom(file.name) };
    return asset;
  }

  const src = await probe(original);
  if (!src.width) throw new IngestError(say("That file has no video track."));
  const out = path.join(dirs.uploads, `${uid}_${purpose}.mp4`);
  let frames: number;
  let fps: number;
  if (purpose === "h3") {
    frames = h3FramesAtMost(Math.min(Math.floor(src.duration * 24), 360));
    fps = 24;
    if (frames < 48) throw new IngestError(say("Use a clip of at least 2 seconds."));
    await conformForH3(original, out, frames);
  } else {
    const { width, height } = planWan(nearestAspect(src.width, src.height));
    fps = 16;
    frames = Math.min(81, Math.floor((Math.floor(src.duration * 16) - 1) / 4) * 4 + 1);
    if (frames < 33) throw new IngestError(say("Use a clip of at least 2 seconds."));
    await conformForWan(original, out, width, height, frames);
  }
  const p = await probe(out);
  await poster(out, path.join(dirs.uploads, `${uid}_${purpose}.jpg`), 0.2).catch(() => {});
  const name = DRY_RUN ? `nf_${uid}.mp4` : await upload(new Blob([await readFile(out)]), `nf_${uid}.mp4`);
  const asset: Asset = {
    name,
    kind: "video",
    url: `/api/files/uploads/${uid}_${purpose}.mp4`,
    width: p.width,
    height: p.height,
    fps,
    frames,
    duration: frames / fps,
    label: labelFrom(file.name),
  };
  return asset;
}

export const labelFrom = (name: string) =>
  path
    .basename(name, path.extname(name))
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 24);

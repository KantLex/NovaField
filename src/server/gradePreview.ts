// "Check exact": one frame through the real NovaLensFilm, so the browser's live preview can be
// trusted before a whole clip is graded. Nothing is saved; ComfyUI keeps the frame as a temp file.

import { Graph } from "@/lib/comfy/graph";
import { filmSupport } from "@/lib/engines/capabilities";
import { filmBlocker } from "@/lib/engines/grade";
import { lensFilm } from "@/lib/engines/h3";
import type { FilmLab } from "@/lib/engines/specs";
import { finished, queuePrompt } from "./comfy";
import { DRY_RUN } from "./config";
import { HUB } from "./hub";
import { capabilities } from "./runner";
import { say } from "@/lib/say";

/** The browser URL of `image` (a file in the ComfyUI input folder) graded with `film`. */
export async function previewFrame(image: string, film: FilmLab, seed: number, timeoutMs = 120_000): Promise<string> {
  if (DRY_RUN) return `/api/comfy-view?filename=${encodeURIComponent(image)}&type=input`;
  const { caps } = await capabilities();
  if (!caps.pack.lensFilm) throw new Error(say("Grading needs the NovaField nodes (NovaLensFilm). Install the pack to unlock it."));
  const why = filmBlocker(film, caps);
  if (why) throw new Error(why);
  const g = new Graph();
  const frame = g.add("LoadImage", { image }, "Frame").out();
  g.add("PreviewImage", { images: lensFilm(g, frame, film, seed, filmSupport(caps).controls) }, "Graded frame");
  const { prompt_id } = await queuePrompt(g.toJSON(), HUB.clientId);
  const h = await finished(prompt_id, timeoutMs, say("The GPU is busy with other work. Try the exact check again in a moment."));
  const f = Object.values(h.outputs).flatMap((o) => o.images ?? [])[0];
  if (!f) throw new Error(say("The render finished but saved no video, image or audio."));
  return `/api/comfy-view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type })}`;
}

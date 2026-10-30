// Shot QC: a finished clip through NovaShotQC on the server. Runs by itself after every clip, so the
// strip can flag a take with a frozen frame or a lurch before anyone cuts with it.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Graph } from "@/lib/comfy/graph";
import type { QcReport } from "@/lib/qc";
import { finished, objectInfo, queuePrompt, upload } from "./comfy";
import { DRY_RUN } from "./config";
import { HUB } from "./hub";
import { dirs } from "./media";
import { STORE } from "./store";
import { say } from "@/lib/say";

/** Whether the server has NovaShotQC (NovaField nodes 0.4.0). */
export const canCheck = async () => !!(await objectInfo().catch(() => null))?.NovaShotQC;

/** Checks a finished clip and keeps the report on the take. */
export async function checkTake(id: string): Promise<QcReport> {
  const job = await STORE.get(id);
  const file = path.join(dirs.media, `${id}.mp4`);
  if (!job?.video || !existsSync(file)) throw new Error(say("Only finished clips can be checked."));
  if (DRY_RUN) throw new Error(say("Shot QC needs a real ComfyUI server."));
  if (!(await canCheck())) throw new Error(say("Shot QC needs NovaField nodes 0.4.0 on the server. Update the NovaField pack in ComfyUI Manager, then restart ComfyUI."));
  const name = await upload(new Blob([await readFile(file)]), `nf_qc_${id}.mp4`);
  const g = new Graph();
  const parts = g.add("GetVideoComponents", { video: g.add("LoadVideo", { file: name }, "Clip").out() });
  const qc = g.add("NovaShotQC", { images: parts.out(0), fps: parts.out(2) }, "Shot QC");
  const { prompt_id } = await queuePrompt(g.toJSON(), HUB.clientId);
  const h = await finished(prompt_id, 10 * 60_000, say("The GPU is busy with other work. Try the check again in a moment."));
  const text = h.outputs[qc.id]?.text?.[0];
  if (!text) throw new Error(say("The check finished but returned no report."));
  const report = { ...(JSON.parse(text) as QcReport), checkedAt: Date.now() };
  await STORE.patch(id, { qc: report });
  return report;
}

/** After a clip finishes: check it if the server can, quietly (a failed check isn't a failed take). */
export async function checkQuietly(id: string) {
  if (DRY_RUN || !(await canCheck())) return;
  await checkTake(id).catch((e) => console.warn(`Shot QC skipped for ${id}:`, e instanceof Error ? e.message : e));
}

// Model files on the ComfyUI server: which are there (from its own file lists), and downloading
// the missing ones through the NovaField node pack (0.5.0+), which fetches them on that PC.

import type { ObjectInfo } from "@/lib/comfy/validate";
import { MODEL_FILES, type ModelJob, type ModelsStatus } from "@/lib/modelFiles";
import { forgetObjectInfo, objectInfo } from "./comfy";
import { comfyFetch, isCloud } from "./connection";
import { say } from "@/lib/say";

/** Every file name the server offers in any loader's list. */
export function filesOnServer(info: ObjectInfo): Set<string> {
  const out = new Set<string>();
  for (const node of Object.values(info))
    for (const inputs of [node.input?.required, node.input?.optional])
      for (const spec of Object.values(inputs ?? {})) {
        const options = Array.isArray(spec) ? spec[0] : null;
        if (Array.isArray(options)) for (const o of options) if (typeof o === "string") out.add(o);
      }
  return out;
}

interface PackStatus {
  version: string;
  files: Record<string, { installed: boolean; job?: ModelJob }>;
}

async function packStatus(): Promise<PackStatus | null> {
  try {
    const res = await comfyFetch("/novafield/models", { timeoutMs: 8000 });
    return res.ok ? ((await res.json()) as PackStatus) : null;
  } catch {
    return null;
  }
}

export async function modelsStatus(): Promise<ModelsStatus> {
  if (isCloud()) return { cloud: true, pack: null, files: {} };
  const [info, pack] = await Promise.all([objectInfo().catch(() => ({}) as ObjectInfo), packStatus()]);
  const there = filesOnServer(info);
  const files: ModelsStatus["files"] = {};
  let arrived = false;
  for (const name of Object.keys(MODEL_FILES)) {
    const p = pack?.files[name];
    files[name] = { installed: there.has(name) || !!p?.installed, ...(p?.job ? { job: p.job } : {}) };
    if (p?.installed && !there.has(name)) arrived = true;
  }
  // A download finished since ComfyUI's lists were read: read them again, so the feature unlocks.
  if (arrived) forgetObjectInfo();
  return { cloud: false, pack: pack?.version ?? null, files };
}

const post = async (path: string, body: unknown) => {
  if (isCloud()) throw new Error(say("Comfy Cloud has its own models; there's nothing to download."));
  const res = await comfyFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 404) throw new Error(say("Update the NovaField nodes on your ComfyUI (0.5.0 or later) to download models from here."));
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? say("ComfyUI refused the download ({status}).", { status: res.status }));
  return j;
};

/** Queue downloads of the named files; returns the ones queued (the rest are there or on their way). */
export async function downloadModels(files: string[]): Promise<string[]> {
  const unknown = files.filter((f) => !(f in MODEL_FILES));
  if (unknown.length) throw new Error(say("NovaField doesn't download {files}.", { files: unknown.join(", ") }));
  return ((await post("/novafield/models/download", { files })) as { queued: string[] }).queued;
}

export async function cancelModel(file: string): Promise<boolean> {
  return ((await post("/novafield/models/cancel", { file })) as { cancelled: boolean }).cancelled;
}

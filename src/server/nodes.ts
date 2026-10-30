// Installing NovaField's own ComfyUI node pack from inside the app, through ComfyUI Manager.

import { capabilities } from "./runner";
import { managerVersion, queueInstalls } from "./packs";
import { say } from "@/lib/say";

/** Registry id and publisher of the pack (comfyui-novafield/pyproject.toml). */
export const NODES_ID = "comfyui-novafield";
export const NODES_PUBLISHER = process.env.NOVAFIELD_NODES_PUBLISHER ?? "novafield";
/** The standalone pack repo, for installs before (or without) the Registry. */
export const NODES_REPO = (process.env.NOVAFIELD_NODES_REPO ?? "https://github.com/KantLex/ComfyUI-NovaField").replace(/\/$/, "");

export interface NodesStatus {
  /** Every NovaField node is on the server. */
  installed: boolean;
  missing: string[];
  manager: string | null;
  /** Where a one-click install would come from, or null when the pack isn't published anywhere yet. */
  source: { kind: "registry"; version: string | null } | { kind: "github"; url: string } | null;
}

const NODES = { ghostRig: "NovaGhostRig", lensFilm: "NovaLensFilm", boxTrack: "NovaBoxTrackMask", contactSheet: "NovaContactSheet" } as const;

async function registrySource(): Promise<NodesStatus["source"]> {
  try {
    const res = await fetch(`https://api.comfy.org/nodes/${NODES_ID}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { publisher?: { id?: string }; latest_version?: { version?: string } };
    // The id is first come, first served: only trust it when our publisher owns it.
    if (j.publisher?.id !== NODES_PUBLISHER) return null;
    return { kind: "registry", version: j.latest_version?.version ?? null };
  } catch {
    return null;
  }
}

async function githubSource(): Promise<NodesStatus["source"]> {
  const m = /github\.com\/([^/]+\/[^/]+)$/.exec(NODES_REPO);
  if (!m) return null;
  try {
    // The raw file host isn't rate-limited like the GitHub API, and finding the pack's own
    // pyproject proves the repo really is the pack.
    const res = await fetch(`https://raw.githubusercontent.com/${m[1]}/HEAD/pyproject.toml`, { signal: AbortSignal.timeout(8000) });
    return res.ok && (await res.text()).includes('name = "comfyui-novafield"') ? { kind: "github", url: NODES_REPO } : null;
  } catch {
    return null;
  }
}

export async function nodesStatus(): Promise<NodesStatus> {
  const { caps } = await capabilities();
  const missing = (Object.keys(NODES) as (keyof typeof NODES)[]).filter((k) => !caps.pack[k]).map((k) => NODES[k]);
  if (!missing.length) return { installed: true, missing, manager: null, source: null };
  const [manager, source] = await Promise.all([managerVersion(), registrySource().then((r) => r ?? githubSource())]);
  return { installed: false, missing, manager, source };
}

export async function installNodes() {
  const s = await nodesStatus();
  if (s.installed) return { tasks: {} };
  if (!s.manager) throw new Error(say("ComfyUI Manager isn't reachable on your server, so NovaField can't install the nodes for you."));
  if (!s.source) throw new Error(say("The NovaField nodes aren't published yet. Copy the comfyui-novafield folder into ComfyUI's custom_nodes folder and restart ComfyUI."));
  const pack =
    s.source.kind === "registry" ? { id: NODES_ID, registry: true, repository: NODES_REPO } : { id: NODES_REPO.replace("https://github.com/", ""), registry: false, repository: NODES_REPO };
  return { tasks: await queueInstalls([pack]) };
}

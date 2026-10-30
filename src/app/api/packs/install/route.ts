import { queueInstalls, type PackSuggestion } from "@/server/packs";
import { say } from "@/lib/say";

/** Queue node pack installs with ComfyUI Manager. Returns a task id per pack. */
export async function POST(request: Request) {
  const { packs } = (await request.json().catch(() => ({}))) as { packs: Pick<PackSuggestion, "id" | "registry" | "repository">[] };
  if (!Array.isArray(packs) || !packs.length || packs.length > 20) return Response.json({ error: say("Choose between 1 and 20 packs.") }, { status: 400 });
  // Only plain pack ids, and git sources over https: the id and repository go straight to ComfyUI Manager.
  const bad = packs.some((p) => !p || typeof p.id !== "string" || !/^[\w.@/-]{1,120}$/.test(p.id) || (p.repository !== undefined && !/^https:\/\/[^\s]+$/.test(String(p.repository))));
  if (bad) return Response.json({ error: say("That pack can't be installed from here.") }, { status: 400 });
  try {
    return Response.json({ tasks: await queueInstalls(packs) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

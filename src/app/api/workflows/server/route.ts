import { connection } from "next/server";
import { comfyFetch } from "@/server/connection";
import { importRecipe } from "@/server/recipes";
import { say } from "@/lib/say";

// Workflows saved in ComfyUI itself (Workflow → Save), read through its user-data API.
export async function GET() {
  await connection();
  try {
    const res = await comfyFetch("/api/userdata?dir=workflows&recurse=true&split=false&full_info=true", { timeoutMs: 8000 });
    if (!res.ok) return Response.json([]);
    const list = (await res.json()) as ({ path: string; modified?: number; size?: number } | string)[];
    const items = list
      .map((x) => (typeof x === "string" ? { path: x } : x))
      .filter((x) => x.path.endsWith(".json"))
      .sort((a, b) => ("modified" in b ? (b.modified ?? 0) : 0) - ("modified" in a ? (a.modified ?? 0) : 0));
    return Response.json(items);
  } catch {
    return Response.json([]);
  }
}

export async function POST(request: Request) {
  const { path } = (await request.json()) as { path: string };
  try {
    const res = await comfyFetch(`/api/userdata/${encodeURIComponent(`workflows/${path}`)}`);
    if (!res.ok) throw new Error(say("ComfyUI could not open {path} ({status}).", { path, status: res.status }));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { graph, original, ...summary } = await importRecipe(await res.json(), path.split("/").pop() ?? path);
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

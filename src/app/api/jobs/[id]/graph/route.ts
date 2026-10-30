import { compile } from "@/lib/engines";
import { capabilities, contextFor } from "@/server/runner";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

// The exact API-format graph, ready to drop onto the ComfyUI canvas.
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/graph">) {
  const { id } = await ctx.params;
  const job = await STORE.get(id);
  if (!job) return Response.json({ error: say("No such take.") }, { status: 404 });
  const graph = STORE.graph(id) ?? compile(job.spec, (await capabilities()).caps, await contextFor(job.spec)).graph;
  return new Response(JSON.stringify(graph, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="novafield_${id}.json"` },
  });
}

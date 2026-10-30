import { compile } from "@/lib/engines";
import { importRecipe } from "@/server/recipes";
import { capabilities, contextFor } from "@/server/runner";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

/** Turn any take into a workflow: the exact graph that made it, ready to edit in graph mode. */
export async function POST(request: Request) {
  const { id } = (await request.json()) as { id: string };
  const job = await STORE.get(id);
  if (!job) return Response.json({ error: say("No such take.") }, { status: 404 });
  try {
    const graph = STORE.graph(id) ?? compile(job.spec, (await capabilities()).caps, await contextFor(job.spec)).graph;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { graph: _g, original, ...summary } = await importRecipe(graph, `${job.title.slice(0, 48)} (graph)`);
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

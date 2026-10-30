import type { ApiGraph } from "@/lib/comfy/graph";
import type { Recipe } from "@/lib/workflows/types";
import { editableGraph, getRecipe, saveGraph } from "@/server/recipes";
import { say } from "@/lib/say";

// Graph mode: the workflow's nodes and where they sit, and saving an edit back.
export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]/graph">) {
  const r = await getRecipe((await ctx.params).id);
  if (!r) return Response.json({ error: say("No such workflow.") }, { status: 404 });
  return Response.json({ graph: await editableGraph(r), layout: r.layout ?? null });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/workflows/[id]/graph">) {
  const { graph, layout } = (await request.json()) as { graph: ApiGraph; layout?: Recipe["layout"] };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { graph: _g, original, ...summary } = await saveGraph((await ctx.params).id, graph, layout);
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

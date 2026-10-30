import { recheckRecipe } from "@/server/recipes";

/** Read the workflow again against the server's current nodes (after installing packs). */
export async function POST(_request: Request, ctx: RouteContext<"/api/workflows/[id]/recheck">) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { graph, original, ...summary } = await recheckRecipe((await ctx.params).id);
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

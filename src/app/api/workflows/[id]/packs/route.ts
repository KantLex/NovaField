import { planPacks } from "@/server/packs";
import { getRecipe } from "@/server/recipes";
import { say } from "@/lib/say";

/** Which node packs would make this workflow runnable. */
export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]/packs">) {
  const r = await getRecipe((await ctx.params).id);
  if (!r) return Response.json({ error: say("No such workflow.") }, { status: 404 });
  try {
    return Response.json({ ...(await planPacks(r.missing)), canRecheck: r.original !== undefined });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

import type { Field } from "@/lib/workflows/types";
import { deleteRecipe, getRecipe, saveRecipe } from "@/server/recipes";
import { say } from "@/lib/say";

export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const r = await getRecipe((await ctx.params).id);
  if (!r) return Response.json({ error: say("No such workflow.") }, { status: 404 });
   
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { graph, original, ...summary } = r;
  return Response.json({ ...summary, nodes: Object.keys(graph).length });
}

/** Rename, or save the curated form (labels, which fields show, defaults). */
export async function PATCH(request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const r = await getRecipe((await ctx.params).id);
  if (!r) return Response.json({ error: say("No such workflow.") }, { status: 404 });
  const body = (await request.json()) as { name?: string; fields?: Partial<Field>[] };
  if (typeof body.name === "string" && body.name.trim()) r.name = body.name.trim().slice(0, 60);
  if (Array.isArray(body.fields)) {
    // Only presentation and defaults can change; where a field lives in the graph is fixed.
    const byId = new Map(body.fields.map((f) => [f.id, f]));
    r.fields = r.fields.map((f) => {
      const p = byId.get(f.id);
      if (!p) return f;
      return {
        ...f,
        label: typeof p.label === "string" && p.label.trim() ? p.label.trim().slice(0, 80) : f.label,
        exposed: typeof p.exposed === "boolean" ? p.exposed : f.exposed,
        advanced: typeof p.advanced === "boolean" ? p.advanced : f.advanced,
        role: p.role ?? f.role,
        randomize: typeof p.randomize === "boolean" ? p.randomize : f.randomize,
        value: p.value !== undefined ? p.value : f.value,
      };
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { graph, original, ...summary } = await saveRecipe(r);
  return Response.json(summary);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  await deleteRecipe((await ctx.params).id);
  return Response.json({ ok: true });
}

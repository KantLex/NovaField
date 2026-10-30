import { deleteProject, renameProject } from "@/server/projects";

export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { name } = (await request.json()) as { name?: string };
  try {
    return Response.json(await renameProject((await ctx.params).id, name ?? ""));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** Deletes the folder only; its takes return to Unsorted. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  await deleteProject((await ctx.params).id);
  return Response.json({ ok: true });
}

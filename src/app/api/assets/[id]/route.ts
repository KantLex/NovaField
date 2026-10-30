import type { AssetEntry } from "@/lib/assets";
import { deleteAsset, updateAsset } from "@/server/assets";

/** Rename, retype, describe, pick the cover, star, reorder or label the files. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const body = (await request.json()) as Partial<Pick<AssetEntry, "name" | "kind" | "description" | "cover" | "favorite">> & {
    order?: string[];
    labels?: Record<string, string>;
  };
  try {
    return Response.json(await updateAsset((await ctx.params).id, body));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/assets/[id]">) {
  await deleteAsset((await ctx.params).id);
  return Response.json({ ok: true });
}

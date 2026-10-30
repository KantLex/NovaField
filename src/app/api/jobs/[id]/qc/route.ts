import { checkTake } from "@/server/qc";

/** Check a finished clip for faults (Shot QC) and keep the report on the take. */
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/qc">) {
  try {
    return Response.json(await checkTake((await ctx.params).id));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

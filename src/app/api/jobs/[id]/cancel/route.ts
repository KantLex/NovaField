import { CancelRefused, cancel } from "@/server/runner";
import { say } from "@/lib/say";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/cancel">) {
  const { id } = await ctx.params;
  try {
    const job = await cancel(id);
    if (!job) return Response.json({ error: say("No such take.") }, { status: 404 });
    return Response.json(job);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof CancelRefused ? 409 : 502 });
  }
}

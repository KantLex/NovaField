import { connection } from "next/server";
import { getSequence, isSequenceKey, putSequence } from "@/server/sequences";
import { say } from "@/lib/say";

/** One project's edit: its clips in cut order. */
export async function GET(_request: Request, ctx: RouteContext<"/api/sequences/[key]">) {
  await connection();
  const { key } = await ctx.params;
  if (!isSequenceKey(key)) return Response.json({ error: say("That isn't a sequence name.") }, { status: 400 });
  return Response.json({ key, clips: await getSequence(key) });
}

/** Replace the edit. Clips, or plain take ids for whole takes; `origin` lets the editor skip its own echo. */
export async function PUT(request: Request, ctx: RouteContext<"/api/sequences/[key]">) {
  const { key } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { clips?: unknown; origin?: string };
  try {
    return Response.json({ key, clips: await putSequence(key, body.clips, typeof body.origin === "string" ? body.origin.slice(0, 40) : undefined) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { connection } from "next/server";
import { isSequenceKey } from "@/server/sequences";
import { getSoundtrack, putSoundtrack } from "@/server/soundtracks";
import { say } from "@/lib/say";

/** One edit's soundtrack, or null. */
export async function GET(_request: Request, ctx: RouteContext<"/api/soundtracks/[key]">) {
  await connection();
  const { key } = await ctx.params;
  if (!isSequenceKey(key)) return Response.json({ error: say("That isn't a sequence name.") }, { status: 400 });
  return Response.json({ key, track: await getSoundtrack(key) });
}

/** Set the soundtrack ({ take } or { url }, with start, mix and volume), or remove it with null; `origin` lets the editor skip its own echo. */
export async function PUT(request: Request, ctx: RouteContext<"/api/soundtracks/[key]">) {
  const { key } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { track?: unknown; origin?: string };
  try {
    return Response.json({ key, track: await putSoundtrack(key, body.track ?? null, typeof body.origin === "string" ? body.origin.slice(0, 40) : undefined) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

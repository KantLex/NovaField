import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { isLive } from "@/lib/jobs";
import { dirs } from "@/server/media";
import { dropTake } from "@/server/sequences";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const job = await STORE.get((await ctx.params).id);
  return job ? Response.json(job) : Response.json({ error: say("No such take.") }, { status: 404 });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const body = (await request.json()) as { favorite?: boolean; project?: string | null; title?: string };
  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 200) : undefined;
  if (title === "") return Response.json({ error: say("A take needs a name.") }, { status: 400 });
  const job = await STORE.patch(id, {
    ...(title !== undefined ? { title } : {}),
    ...(body.favorite !== undefined ? { favorite: !!body.favorite } : {}),
    ...(body.project !== undefined ? { project: body.project ?? undefined } : {}),
  });
  return job ? Response.json(job) : Response.json({ error: say("No such take.") }, { status: 404 });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await STORE.get(id);
  if (!job) return Response.json({ error: say("No such take.") }, { status: 404 });
  if (isLive(job)) return Response.json({ error: say("Cancel the render before deleting it.") }, { status: 409 });
  await STORE.remove(id);
  await dropTake(id);
  // Local copies only; files on the ComfyUI server stay where they are.
  const files = await readdir(dirs.media).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => f === id || f.startsWith(`${id}.`) || f.startsWith(`${id}_`)).map((f) => rm(path.join(dirs.media, f), { force: true })));
  return Response.json({ ok: true });
}

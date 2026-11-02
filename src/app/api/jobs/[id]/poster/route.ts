import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dirs, ensureDirs } from "@/server/media";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

const MAX_BYTES = 4 << 20;

/**
 * A poster for a 3D take, drawn by the browser's viewer the first time the model is opened (a 3D
 * workflow that saved no picture leaves its take without one). Never replaces a poster it has.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/jobs/[id]/poster">) {
  const { id } = await ctx.params;
  const job = await STORE.get(id);
  if (!job) return Response.json({ error: say("No such take.") }, { status: 404 });
  if (!job.model) return Response.json({ error: say("Only a 3D take gets its poster this way.") }, { status: 400 });
  if (job.poster) return Response.json(job);
  const data = Buffer.from(await request.arrayBuffer());
  // A JPEG, and a small one.
  if (data.length > MAX_BYTES || data[0] !== 0xff || data[1] !== 0xd8) return Response.json({ error: say("Send the poster as a JPEG under 4 MB.") }, { status: 400 });
  await ensureDirs();
  await writeFile(path.join(dirs.media, `${id}_poster.jpg`), data);
  return Response.json(await STORE.patch(id, { poster: `/api/files/media/${id}_poster.jpg` }));
}

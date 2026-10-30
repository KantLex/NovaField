import { existsSync } from "node:fs";
import path from "node:path";
import type { Purpose } from "@/lib/assets";
import { ingest, IngestError } from "@/server/ingest";
import { dirs } from "@/server/media";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

/** Make a finished take's file ready for a purpose (a Henshin source clip, a frame, a reference), like an upload. */
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/use">) {
  const job = await STORE.get((await ctx.params).id);
  if (!job) return Response.json({ error: say("No such take.") }, { status: 404 });
  const { purpose = "image" } = (await request.json().catch(() => ({}))) as { purpose?: Purpose };
  const url = purpose === "image" ? (job.image ?? job.poster) : purpose === "raw" ? (job.video ?? job.image ?? job.audio) : job.video;
  if (!url) return Response.json({ error: purpose === "image" ? say("That take has no picture.") : say("That take has no video.") }, { status: 400 });
  // Local copies only, by file name, so a URL can't point outside the media folder.
  const file = path.join(dirs.media, path.basename(url));
  if (!existsSync(file)) return Response.json({ error: say("The take's file is missing.") }, { status: 404 });
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".mp4" ? "video/mp4" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : [".mp3", ".wav", ".flac"].includes(ext) ? `audio/${ext.slice(1)}` : "image/jpeg";
  try {
    return Response.json(await ingest(file, `${job.title || job.id}${ext}`, mime, purpose, url));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, { status: e instanceof IngestError ? 400 : 502 });
  }
}

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { dirs, ensureDirs, stillsToVideo } from "@/server/media";
import { ingest, IngestError } from "@/server/ingest";
import { say } from "@/lib/say";

/** A guide runs 2 to 15 s, at most 360 frames (15 s at H3's 24 fps). */
const MIN_SECONDS = 2;
const MAX_SECONDS = 15;
const MAX_FRAMES = 360;
const MAX_FRAME_BYTES = 1_500_000;

// The 3D previs as H3's guide video: the browser draws the set through the shot's camera, one
// JPEG per frame, and this turns them into a reference video ready for H3 (like an "h3" upload).
export async function POST(request: Request) {
  await ensureDirs();
  const form = await request.formData().catch(() => null);
  const frames = form?.getAll("frame").filter((f): f is File => f instanceof File) ?? [];
  const fps = Number(form?.get("fps") ?? 24);
  if (!(fps > 0 && fps <= 60)) return Response.json({ error: say("A guide needs a frame rate.") }, { status: 400 });
  const seconds = frames.length / fps;
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS || frames.length > MAX_FRAMES)
    return Response.json({ error: say("A guide needs 2 to 15 seconds of frames.") }, { status: 400 });

  const uid = randomUUID().slice(0, 10);
  const stills = path.join(dirs.uploads, `${uid}_stills`);
  const video = path.join(dirs.uploads, `${uid}.mp4`);
  try {
    await mkdir(stills, { recursive: true });
    for (const [i, f] of frames.entries()) {
      const bytes = Buffer.from(await f.arrayBuffer());
      // JPEG only: a still that isn't one stops here rather than reaching ffmpeg.
      if (bytes.length > MAX_FRAME_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new IngestError(say("A guide frame isn't a JPEG picture."));
      await writeFile(path.join(stills, `${String(i).padStart(4, "0")}.jpg`), bytes);
    }
    await stillsToVideo(stills, fps, video);
    return Response.json(await ingest(video, "3D previs.mp4", "video/mp4", "h3", `/api/files/uploads/${uid}.mp4`));
  } catch (e) {
    const status = e instanceof IngestError ? 400 : 502;
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, { status });
  } finally {
    await rm(stills, { recursive: true, force: true });
  }
}

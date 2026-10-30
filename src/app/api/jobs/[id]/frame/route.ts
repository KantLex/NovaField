import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "@/lib/engines/specs";
import { upload } from "@/server/comfy";
import { DRY_RUN } from "@/server/config";
import { dirs, frameAt, lastFrame, probe } from "@/server/media";
import { say } from "@/lib/say";

// A frame of a take (the last one unless `at` seconds says otherwise), uploaded as an image so it
// can start the next shot, cast a character or become a still.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/frame">) {
  const { id } = await ctx.params;
  // The id names files on disk, so it must be a plain take id.
  if (!/^[\w-]+$/.test(id)) return Response.json({ error: say("No such take.") }, { status: 404 });
  const { at } = (await request.json().catch(() => ({}))) as { at?: number };
  const video = path.join(dirs.media, `${id}.mp4`);
  if (!existsSync(video)) return Response.json({ error: say("That take is not on disk.") }, { status: 404 });
  const p = await probe(video);
  const last = at === undefined || !Number.isFinite(at) || at >= p.duration - 0.05;
  const t = last ? 0 : Math.max(0, Number(at));
  const base = last ? `${id}_last` : `${id}_f${Math.round(t * 1000)}`;
  const file = path.join(dirs.media, `${base}.png`);
  await (last ? lastFrame(video, file) : frameAt(video, file, t));
  const name = DRY_RUN ? `nf_${base}.png` : await upload(new Blob([await readFile(file)]), `nf_${base}.png`);
  const asset: Asset = { name, kind: "image", url: `/api/files/media/${base}.png`, width: p.width, height: p.height, label: last ? "Last frame" : `Frame at ${t.toFixed(2)} s` };
  return Response.json(asset);
}

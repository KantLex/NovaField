import { existsSync } from "node:fs";
import path from "node:path";
import { ingest, IngestError } from "@/server/ingest";
import { storageRoot } from "@/server/storage";
import { say } from "@/lib/say";

/** An original the app keeps: an upload, a take or a library asset. */
const ORIGINAL = /^\/api\/files\/(uploads|media|assets)\/([\w.-]+)$/;

// Choose another part of a clip for Henshin: cut it again from its original, from `start` seconds,
// at most `seconds` long, for H3 (Recast, Restyle) or Wan (Replace).
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown; purpose?: unknown; start?: unknown; seconds?: unknown; label?: unknown } | null;
  const m = typeof body?.url === "string" ? ORIGINAL.exec(body.url) : null;
  const purpose = body?.purpose;
  const start = Number(body?.start);
  const seconds = body?.seconds === undefined ? undefined : Number(body.seconds);
  if (!m || m[2].includes("..")) return Response.json({ error: say("That clip isn't one NovaField keeps.") }, { status: 400 });
  if (purpose !== "h3" && purpose !== "wan") return Response.json({ error: say("Unknown upload purpose.") }, { status: 400 });
  if (!(start >= 0) || (seconds !== undefined && !(seconds >= 2))) return Response.json({ error: say("Choose a part at least 2 seconds long.") }, { status: 400 });
  const file = path.join(storageRoot(), m[1], m[2]);
  if (!existsSync(file)) return Response.json({ error: say("The original clip is gone; drop it again.") }, { status: 404 });
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : "Clip";
  try {
    return Response.json(await ingest(file, `${label}${path.extname(file)}`, "video/mp4", purpose, body!.url as string, { start, seconds }));
  } catch (e) {
    const status = e instanceof IngestError ? 400 : 502;
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, { status });
  }
}

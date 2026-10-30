import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { dirs, ensureDirs } from "@/server/media";
import { ingest, IngestError, type Purpose } from "@/server/ingest";
import { say } from "@/lib/say";

const PURPOSES: Purpose[] = ["image", "h3", "wan", "raw", "track"];

// Upload a file, conform it to what its model expects, and place it in ComfyUI's input folder.
export async function POST(request: Request) {
  await ensureDirs();
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: say("Attach a file.") }, { status: 400 });
  const file = form.get("file");
  const purpose = String(form.get("purpose") ?? "image") as Purpose;
  if (!(file instanceof File)) return Response.json({ error: say("Attach a file.") }, { status: 400 });
  if (!PURPOSES.includes(purpose)) return Response.json({ error: say("Unknown upload purpose.") }, { status: 400 });

  const uid = randomUUID().slice(0, 10);
  const ext = (path.extname(file.name) || (file.type.startsWith("video") ? ".mp4" : ".png")).toLowerCase();
  const original = path.join(dirs.uploads, `${uid}${ext}`);
  await writeFile(original, Buffer.from(await file.arrayBuffer()));

  try {
    return Response.json(await ingest(original, file.name, file.type, purpose, `/api/files/uploads/${uid}${ext}`));
  } catch (e) {
    const status = e instanceof IngestError ? 400 : 502;
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, { status });
  }
}

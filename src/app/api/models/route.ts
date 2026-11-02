import { connection } from "next/server";
import { downloadModels, modelsStatus } from "@/server/models";
import { say } from "@/lib/say";

/** Which of NovaField's model files the server has, and any downloads under way. */
export async function GET() {
  await connection();
  return Response.json(await modelsStatus());
}

/** Download missing model files onto the ComfyUI PC: { files: [file names] }. */
export async function POST(request: Request) {
  const { files } = (await request.json().catch(() => ({}))) as { files?: unknown };
  if (!Array.isArray(files) || !files.length || files.length > 40 || !files.every((f) => typeof f === "string"))
    return Response.json({ error: say("Choose the model files to download.") }, { status: 400 });
  try {
    return Response.json({ queued: await downloadModels(files) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

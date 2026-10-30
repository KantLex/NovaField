import type { Purpose } from "@/lib/assets";
import { IngestError } from "@/server/ingest";
import { prepareItems } from "@/server/assets";

/** Make an asset's files (all, or some) ready for a purpose and hand back ComfyUI-ready assets. */
export async function POST(request: Request) {
  const { id, items, purpose } = (await request.json()) as { id: string; items?: string[]; purpose: Purpose };
  try {
    return Response.json(await prepareItems(id, items, purpose ?? "image"));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) }, { status: e instanceof IngestError ? 400 : 502 });
  }
}

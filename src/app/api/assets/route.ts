import { connection } from "next/server";
import type { AssetKind } from "@/lib/assets";
import { createAsset, listAssets } from "@/server/assets";

// The asset library: characters, objects, locations, styles and clips.
export async function GET() {
  await connection();
  return Response.json(await listAssets());
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name: string; kind: AssetKind; description?: string };
  try {
    return Response.json(await createAsset(body));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

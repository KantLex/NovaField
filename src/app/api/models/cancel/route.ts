import { cancelModel } from "@/server/models";

/** Stop a model download and drop what came so far: { file }. */
export async function POST(request: Request) {
  const { file } = (await request.json().catch(() => ({}))) as { file?: unknown };
  if (typeof file !== "string" || !file) return Response.json({ error: "file" }, { status: 400 });
  try {
    return Response.json({ cancelled: await cancelModel(file) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

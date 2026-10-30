import { installNodes } from "@/server/nodes";

/** Queue the NovaField node pack install with ComfyUI Manager. */
export async function POST() {
  try {
    return Response.json(await installNodes());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

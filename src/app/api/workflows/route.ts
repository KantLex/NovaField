import { connection } from "next/server";
import { importRecipe, listRecipes } from "@/server/recipes";

export async function GET() {
  await connection();
  return Response.json(await listRecipes());
}

/** Import a workflow JSON (canvas or API format) as a NovaField app. */
export async function POST(request: Request) {
  const { json, source } = (await request.json()) as { json: unknown; source?: string };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { graph, original, ...summary } = await importRecipe(json, source || "Imported workflow");
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

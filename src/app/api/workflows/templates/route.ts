import { connection } from "next/server";
import { importRecipe } from "@/server/recipes";
import { templateJson, templateLibrary } from "@/server/templates";

// ComfyUI's template library, for the Workflows page's template browser.
export async function GET() {
  await connection();
  try {
    return Response.json(await templateLibrary());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** Import a template as a NovaField workflow, named after its title. */
export async function POST(request: Request) {
  const { name, pack, title } = (await request.json()) as { name: string; pack?: string; title?: string };
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { graph, original, ...summary } = await importRecipe(await templateJson(name, pack), title || name);
    return Response.json(summary);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

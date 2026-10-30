import type { FilmLab } from "@/lib/engines/specs";
import { previewFrame } from "@/server/gradePreview";

/** One frame (already in the ComfyUI input folder) through NovaLensFilm, for the grade tool's exact check. */
export async function POST(request: Request) {
  const { image, film, seed = 0 } = (await request.json()) as { image?: string; film?: FilmLab; seed?: number };
  if (!image || !film) return Response.json({ error: "Missing image or film." }, { status: 400 });
  try {
    return Response.json({ url: await previewFrame(image, film, seed) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

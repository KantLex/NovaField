import { projectExists, touchProject } from "@/server/projects";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

/** Move takes into a project (or back to Unsorted with project: null). */
export async function POST(request: Request) {
  const { ids, project } = (await request.json().catch(() => ({}))) as { ids: string[]; project: string | null };
  if (!Array.isArray(ids) || !ids.length) return Response.json({ error: say("Pick at least one take.") }, { status: 400 });
  if (project && !(await projectExists(project))) return Response.json({ error: say("That project no longer exists.") }, { status: 404 });
  let moved = 0;
  for (const id of ids.slice(0, 500)) if (typeof id === "string" && (await STORE.patch(id, { project: project ?? undefined }))) moved++;
  await touchProject(project ?? undefined);
  return Response.json({ moved });
}

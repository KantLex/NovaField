import { connection } from "next/server";
import { createProject, listProjects } from "@/server/projects";

export async function GET() {
  await connection();
  return Response.json(await listProjects());
}

export async function POST(request: Request) {
  const { name } = (await request.json()) as { name?: string };
  try {
    return Response.json(await createProject(name ?? ""));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

import { installStatus } from "@/server/packs";

export async function POST(request: Request) {
  const { tasks } = (await request.json()) as { tasks: Record<string, string> };
  return Response.json(await installStatus(tasks ?? {}));
}

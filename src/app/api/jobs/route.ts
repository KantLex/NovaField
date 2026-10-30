import { connection } from "next/server";
import { checkBudget } from "@/lib/comfy/budget";
import { KIND_LABEL, type JobSpec } from "@/lib/engines/specs";
import { projectExists, touchProject } from "@/server/projects";
import { preflight, submit } from "@/server/runner";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

export async function GET() {
  await connection();
  return Response.json(await STORE.all());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as (({ spec: JobSpec } | { specs: JobSpec[] }) & { project?: string | null; maxCredits?: number }) | null;
  if (!body || typeof body !== "object") return Response.json({ error: say("Send a job to run.") }, { status: 400 });
  const specs: unknown = "specs" in body ? body.specs : [body.spec];
  if (!Array.isArray(specs) || !specs.length || specs.length > 8) return Response.json({ error: say("Send between 1 and 8 jobs at a time.") }, { status: 400 });
  if (!specs.every((s) => s && typeof s === "object" && typeof (s as JobSpec).kind === "string" && (s as JobSpec).kind in KIND_LABEL)) {
    return Response.json({ error: say("That isn't a job NovaField knows how to run.") }, { status: 400 });
  }
  // Agents send a ceiling in credits: nothing is queued if the priced graphs could go over it.
  if (body.maxCredits !== undefined) {
    if (!Number.isFinite(Number(body.maxCredits))) return Response.json({ error: say("The credit limit must be a number.") }, { status: 400 });
    const budget = checkBudget(await Promise.all((specs as JobSpec[]).map((s) => preflight(s))), Number(body.maxCredits));
    if (!budget.ok) return Response.json({ error: budget.reason, credits: budget.credits }, { status: 402 });
  }
  // New takes land in the project the person is working in (if it still exists).
  const project = body.project && (await projectExists(body.project)) ? body.project : undefined;
  const jobs = [];
  for (const spec of specs as JobSpec[]) jobs.push(await submit(spec, project));
  await touchProject(project);
  return Response.json(jobs);
}

import type { JobSpec } from "@/lib/engines/specs";
import { preflight } from "@/server/runner";

export async function POST(request: Request) {
  const { spec } = (await request.json()) as { spec: JobSpec };
  try {
    const { compiled, issues, warnings, paid, price, blocker } = await preflight(spec);
    return Response.json({ meta: compiled?.meta ?? null, nodes: compiled ? Object.keys(compiled.graph).length : 0, graph: compiled?.graph ?? null, issues, warnings, paid, price, blocker });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

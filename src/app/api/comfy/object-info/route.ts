import { connection } from "next/server";
import { objectInfo } from "@/server/comfy";

// The server's node list for graph mode, trimmed to what the editor draws and checks.
export async function GET() {
  await connection();
  try {
    const info = await objectInfo();
    const slim = Object.fromEntries(
      Object.entries(info).map(([k, n]) => {
        const x = n as typeof n & { category?: string; description?: string; input_order?: unknown; output_is_list?: unknown; deprecated?: boolean };
        return [
          k,
          {
            input: x.input,
            input_order: x.input_order,
            output: x.output,
            output_name: x.output_name,
            display_name: x.display_name,
            category: x.category,
            description: typeof x.description === "string" ? x.description.slice(0, 280) : undefined,
            output_node: x.output_node,
            api_node: x.api_node,
            deprecated: x.deprecated,
          },
        ];
      }),
    );
    return Response.json(slim, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

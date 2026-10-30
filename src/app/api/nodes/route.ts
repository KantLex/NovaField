import { connection } from "next/server";
import { nodesStatus } from "@/server/nodes";

/** Is NovaField's node pack on the server, and can it be installed from here? */
export async function GET() {
  await connection();
  return Response.json(await nodesStatus());
}

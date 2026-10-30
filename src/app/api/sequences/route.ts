import { connection } from "next/server";
import { allSequences } from "@/server/sequences";

/** Every saved edit, by project id ("all" when no project is chosen). */
export async function GET() {
  await connection();
  return Response.json(await allSequences());
}

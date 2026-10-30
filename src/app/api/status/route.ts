import { connection } from "next/server";
import { STATUS } from "@/server/status";

export async function GET() {
  await connection();
  return Response.json(await STATUS.read());
}

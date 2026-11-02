import { connection } from "next/server";
import { allSoundtracks } from "@/server/soundtracks";

/** Every edit's soundtrack, by project id ("all" when no project is chosen). */
export async function GET() {
  await connection();
  return Response.json(await allSoundtracks());
}

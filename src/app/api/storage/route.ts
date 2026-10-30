import { connection } from "next/server";
import { isLive } from "@/lib/jobs";
import { chooseFolder, moveStorage, revealStorage, StorageError, storageInfo } from "@/server/storage";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

/** Where takes, films and uploads are kept, and how much room they take. */
export async function GET() {
  await connection();
  return Response.json(await storageInfo());
}

/** Copy everything to another folder and use it from now on. Nothing is deleted anywhere. */
export async function PUT(request: Request) {
  const { root } = (await request.json().catch(() => ({}))) as { root?: string };
  // A take still rendering would land in the old folder.
  const live = (await STORE.all()).filter((j) => isLive(j) && !j.dryRun).length;
  if (live) return Response.json({ error: live === 1 ? say("Wait for the take still rendering, then change the folder.") : say("Wait for {n} takes still rendering, then change the folder.", { n: live }) }, { status: 409 });
  try {
    const moved = await moveStorage(root ?? "");
    return Response.json({ ...moved, info: await storageInfo() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof StorageError ? 400 : 500 });
  }
}

/** On this computer: pick a folder with the system's own dialog, or show the current one. */
export async function POST(request: Request) {
  const { action } = (await request.json().catch(() => ({}))) as { action?: "choose" | "reveal" };
  if (action === "choose") return Response.json({ path: await chooseFolder() });
  if (action === "reveal") {
    await revealStorage();
    return Response.json({ ok: true });
  }
  return Response.json({ error: say("Unknown action.") }, { status: 400 });
}

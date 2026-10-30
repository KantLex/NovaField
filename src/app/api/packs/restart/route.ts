import { queueState } from "@/server/comfy";
import { restartComfy } from "@/server/packs";

/**
 * Restart ComfyUI so new packs load. The server is shared: when anything is rendering or
 * waiting, refuse unless the person has seen that and chose to go ahead.
 */
export async function POST(request: Request) {
  const { force } = (await request.json().catch(() => ({}))) as { force?: boolean };
  const q = await queueState().catch(() => null);
  const busy = q ? q.queue_running.length + q.queue_pending.length : 0;
  if (busy && !force) return Response.json({ busy }, { status: 409 });
  try {
    await restartComfy();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

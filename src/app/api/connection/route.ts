import { connection as dynamic } from "next/server";
import { isLive } from "@/lib/jobs";
import { connection, normalizeUrl, publicConnection, saveConnection, testConnection, type Connection, type ConnectionMode } from "@/server/connection";
import { HUB } from "@/server/hub";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

interface Body {
  mode?: ConnectionMode;
  url?: string;
  /** Left out keeps the saved key; "" removes it. */
  cloudKey?: string;
  apiKey?: string;
  /** Only try it, don't save. */
  test?: boolean;
  /** Save only if the test passes (connect-on-paste). */
  ifWorks?: boolean;
}

function merge(b: Body): Connection {
  const now = connection();
  return {
    mode: b.mode === "cloud" ? "cloud" : b.mode === "local" ? "local" : now.mode,
    url: b.url?.trim() ? normalizeUrl(b.url) : now.url,
    cloudKey: b.cloudKey === undefined ? now.cloudKey : b.cloudKey.trim(),
    apiKey: b.apiKey === undefined ? now.apiKey : b.apiKey.trim(),
  };
}

export async function GET() {
  await dynamic();
  return Response.json(publicConnection());
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const next = merge(body);
  if (next.mode === "local" && !URL.canParse(next.url)) return Response.json({ error: say("That isn't a web address.") }, { status: 400 });
  const test = await testConnection(next);
  if (body.test || (body.ifWorks && !test.ok)) return Response.json({ test });

  const now = connection();
  const moving = next.mode !== now.mode || (next.mode === "local" && next.url !== now.url);
  if (moving) {
    // A take in flight reports to the server it was sent to; switching would strand it.
    const live = (await STORE.all()).filter((j) => isLive(j) && !j.dryRun).length;
    if (live) return Response.json({ error: live === 1 ? say("Wait for the take still rendering, or cancel it, then switch.") : say("Wait for {n} takes still rendering, or cancel them, then switch.", { n: live }), live }, { status: 409 });
  }
  await saveConnection(next);
  if (moving || next.cloudKey !== now.cloudKey) HUB.reset();
  return Response.json({ connection: publicConnection(), test });
}

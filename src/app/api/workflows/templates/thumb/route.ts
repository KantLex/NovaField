import { connection } from "next/server";
import { comfyFetch } from "@/server/connection";
import { SAFE_NAME } from "@/server/templates";

// A template's preview (image, short video or audio clip), passed through from ComfyUI.
export async function GET(request: Request) {
  await connection();
  const q = new URL(request.url).searchParams;
  const name = q.get("name") ?? "";
  const ext = q.get("ext") ?? "webp";
  if (!SAFE_NAME.test(name) || !/^[a-z0-9]+$/i.test(ext)) return new Response("Bad template name", { status: 400 });
  const res = await comfyFetch(`/templates/${name}-1.${ext}`, { raw: true }).catch(() => null);
  if (!res?.ok) return new Response("No preview", { status: 404 });
  return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=86400" } });
}

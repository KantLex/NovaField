import { comfyFile } from "@/server/connection";

// Preview a file that lives on the ComfyUI server (a workflow's default input image, say).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filename = url.searchParams.get("filename");
  if (!filename) return new Response("Missing filename", { status: 400 });
  const q = new URLSearchParams({ filename, type: url.searchParams.get("type") ?? "input", subfolder: url.searchParams.get("subfolder") ?? "" });
  const res = await comfyFile(`/view?${q}`, { timeoutMs: 15000 }).catch(() => null);
  if (!res?.ok || !res.body) return new Response("Not found", { status: 404 });
  return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "cache-control": "private, max-age=600" } });
}

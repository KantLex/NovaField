import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { storageRoot } from "@/server/storage";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
};
const ROOTS = new Set(["uploads", "media", "films", "assets"]);

// Local renders and uploads, with byte ranges so video scrubbing works.
export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const parts = (await ctx.params).path;
  if (!ROOTS.has(parts[0]) || parts.some((p) => p.includes("..") || p.includes("/"))) return new Response("Not found", { status: 404 });
  const file = path.join(storageRoot(), ...parts);
  let size: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range");
  const headers: Record<string, string> = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    // "bytes=-500" is the last 500 bytes; an empty or backwards range can't be served.
    const suffix = !m?.[1] && m?.[2] ? Number(m[2]) : null;
    const start = suffix !== null ? Math.max(0, size - suffix) : m?.[1] ? Number(m[1]) : 0;
    const end = suffix !== null ? size - 1 : m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || end < start) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}

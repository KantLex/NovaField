import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
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
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "model/obj",
  ".ply": "application/octet-stream",
  ".stl": "model/stl",
  ".fbx": "application/octet-stream",
};
const ROOTS = new Set(["uploads", "media", "films", "assets"]);

// Local renders and uploads, with byte ranges so video scrubbing works. Each answer names the file's
// version (size and time), so once the hour's cache runs out the browser asks again and hears "not
// modified" instead of fetching every poster and strip in the library anew.
export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const parts = (await ctx.params).path;
  if (!ROOTS.has(parts[0]) || parts.some((p) => p.includes("..") || p.includes("/"))) return new Response("Not found", { status: 404 });
  const file = path.join(storageRoot(), ...parts);
  let size: number;
  let modified: Date;
  try {
    const st = await stat(file);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    size = st.size;
    modified = st.mtime;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const etag = `"${size.toString(36)}-${Math.floor(modified.getTime()).toString(36)}"`;
  const headers: Record<string, string> = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    etag,
    "last-modified": modified.toUTCString(),
  };
  if (request.headers.get("if-none-match")?.split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers });
  // A range for another version of the file gets the whole of this one instead.
  const ifRange = request.headers.get("if-range");
  const range = ifRange && ifRange !== etag && ifRange !== headers["last-modified"] ? null : request.headers.get("range");
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

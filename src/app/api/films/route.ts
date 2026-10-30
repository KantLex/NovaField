import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { layout, normalize, sanitize, type Clip } from "@/lib/sequence";
import { assemble, dirs, ensureDirs, probe, type Soundtrack } from "@/server/media";
import { STORE } from "@/server/store";
import { say } from "@/lib/say";

// Cut an edit into one film: clips trimmed to their in and out points, joined by cuts or dissolves,
// optionally under a soundtrack uploaded with purpose "track". Older callers send `takes` (whole
// takes); those become clips without their repeated head frames.
export async function POST(request: Request) {
  await ensureDirs();
  const body = (await request.json()) as { clips?: Clip[]; takes?: string[]; title?: string; soundtrack?: Omit<Soundtrack, "file"> & { url: string } };
  const ids = [...new Set([...(body.clips ?? []).map((c) => c.take), ...(body.takes ?? [])])];
  const jobs = new Map((await Promise.all(ids.map((id) => STORE.get(id)))).flatMap((j) => (j ? [[j.id, j] as const] : [])));
  const source = (t: string) => {
    const m = jobs.get(t)?.meta;
    return m ? { seconds: m.seconds, fps: m.fps || 24, trimHead: m.trimHead } : undefined;
  };
  // Clips from agents arrive as sent: keep every in and out inside its take before cutting.
  const clips = normalize(body.clips ?? body.takes ?? [], source).map((c) => sanitize(c, source(c.take)));
  if (!clips.length) return Response.json({ error: say("Add at least one finished take.") }, { status: 400 });

  const { placed } = layout(clips);
  const parts = [];
  for (const [i, p] of placed.entries()) {
    const job = jobs.get(p.clip.take);
    const file = path.join(dirs.media, `${p.clip.take}.mp4`);
    if (!job || job.status !== "done" || !existsSync(file)) return Response.json({ error: say("Clip {n} is not a finished take.", { n: i + 1 }) }, { status: 400 });
    // A clip with no known end yet runs to the end of its file (the assembler stops at the file's length).
    parts.push({ file, in: p.clip.in, out: p.clip.out > p.clip.in ? p.clip.out : 1e6, fadeIn: p.fadeIn, muted: p.clip.muted });
  }
  let soundtrack: Soundtrack | undefined;
  if (body.soundtrack) {
    // Only a file uploaded here: its URL names a file in the uploads folder, nothing else.
    const name = body.soundtrack.url.startsWith("/api/files/uploads/") ? path.basename(body.soundtrack.url) : "";
    const file = name && path.join(dirs.uploads, name);
    if (!file || !existsSync(file)) return Response.json({ error: say("Upload the soundtrack first (purpose “track”).") }, { status: 400 });
    const { start, mix, volume } = body.soundtrack;
    soundtrack = { file, start: Math.max(0, Number(start) || 0), mix: mix === "under" ? "under" : "replace", volume: Math.min(1, Math.max(0, volume ?? 1)) };
  }
  const first = jobs.get(clips[0].take)!.meta;
  const size = first && first.width > 0 ? { width: first.width - (first.width % 2), height: first.height - (first.height % 2) } : null;
  const id = randomUUID().slice(0, 8);
  const out = path.join(dirs.films, `${id}.mp4`);
  try {
    await assemble(parts, out, size ?? (await sizeOf(parts[0].file)), soundtrack);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.split("\n").slice(-3).join(" ") : String(e) }, { status: 500 });
  }
  return Response.json({ id, url: `/api/files/films/${id}.mp4`, title: body.title ?? "Untitled film" });
}

/** The first clip's frame size from its file, for takes whose metadata doesn't record it. */
async function sizeOf(file: string) {
  const p = await probe(file);
  return { width: p.width - (p.width % 2) || 1280, height: p.height - (p.height % 2) || 720 };
}

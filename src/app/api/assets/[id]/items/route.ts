import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { addItems, localFile, removeItem } from "@/server/assets";
import { dirs, ensureDirs } from "@/server/media";
import { say } from "@/lib/say";

/**
 * Add files to an asset: uploaded files (multipart, field "file", repeatable), or files the app
 * already has, such as a finished take (JSON { urls: ["/api/files/media/…"] }).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/assets/[id]/items">) {
  const { id } = await ctx.params;
  try {
    const files: { path: string; name: string }[] = [];
    const temp: string[] = [];
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      await ensureDirs();
      const form = await request.formData();
      for (const f of form.getAll("file")) {
        if (!(f instanceof File)) continue;
        const tmp = path.join(dirs.uploads, `${randomUUID().slice(0, 10)}${path.extname(f.name).toLowerCase() || ".png"}`);
        await writeFile(tmp, Buffer.from(await f.arrayBuffer()));
        files.push({ path: tmp, name: f.name });
        temp.push(tmp);
      }
    } else {
      const { urls } = (await request.json()) as { urls: string[] };
      for (const u of urls ?? []) {
        const p = localFile(u);
        if (!p) throw new Error(say("That file isn't one NovaField made or stores."));
        files.push({ path: p, name: path.basename(p) });
      }
    }
    if (!files.length) throw new Error(say("Add at least one image, video or audio file."));
    const entry = await addItems(id, files).finally(() => Promise.all(temp.map((t) => rm(t, { force: true }))));
    return Response.json(entry);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/assets/[id]/items">) {
  const item = new URL(request.url).searchParams.get("item") ?? "";
  try {
    const left = await removeItem((await ctx.params).id, item);
    return Response.json(left ?? { removed: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

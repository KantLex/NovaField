// ComfyUI's template library (Workflow → Browse Templates), read from the server it ships with.

import { comfyFetch, connectionId } from "./connection";
import { say } from "@/lib/say";

export interface TemplateCard {
  name: string;
  title: string;
  description: string;
  /** What it makes: image, video, audio, 3d. */
  media: string;
  /** Thumbnail file type (webp, mp4, mp3…). */
  thumb: string;
  tags: string[];
  models: string[];
  /** Runs on a paid API (Comfy account credits) rather than the local GPU. */
  api: boolean;
  date?: string;
  usage?: number;
  tutorial?: string;
}

export interface TemplateCategory {
  title: string;
  group: string;
  type?: string;
  templates: TemplateCard[];
}

export interface TemplateLibrary {
  categories: TemplateCategory[];
  /** Example workflows bundled with installed node packs. */
  packs: { pack: string; name: string }[];
}

type RawTemplate = {
  name: string;
  title?: string;
  description?: string;
  mediaType?: string;
  mediaSubtype?: string;
  tags?: string[];
  models?: string[];
  openSource?: boolean;
  date?: string;
  usage?: number;
  tutorialUrl?: string;
  status?: string;
};
type RawCategory = { title: string; category?: string; type?: string; templates: RawTemplate[] };

export const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

const OUTPUTS = ["image", "video", "audio", "3d"];

/**
 * What a template makes. A template's own `mediaType` is its thumbnail's (most video templates
 * have a still), so the category's type wins when it names an output.
 */
export const cardMedia = (categoryType: string | undefined, mediaType: string | undefined) =>
  categoryType && OUTPUTS.includes(categoryType) ? categoryType : (mediaType ?? "image");

let cache: { at: number; id: string; lib: TemplateLibrary } | null = null;

/** The library, trimmed to what the browser shows. Cached for ten minutes. */
export async function templateLibrary(): Promise<TemplateLibrary> {
  if (cache?.id === connectionId() && Date.now() - cache.at < 10 * 60_000) return cache.lib;
  const res = await comfyFetch("/templates/index.json", { raw: true });
  if (!res.ok) throw new Error(say("ComfyUI has no template library ({status}). Templates come with ComfyUI 0.3.30 and later.", { status: res.status }));
  const raw = (await res.json()) as RawCategory[];
  const categories = raw.map((c) => ({
    title: c.title,
    group: c.category ?? "",
    type: c.type,
    templates: c.templates
      .filter((t) => SAFE_NAME.test(t.name) && t.status !== "archived" && t.status !== "deprecated")
      .map((t) => ({
        name: t.name,
        title: t.title ?? t.name,
        description: t.description ?? "",
        media: cardMedia(c.type, t.mediaType),
        thumb: t.mediaSubtype ?? "webp",
        tags: t.tags ?? [],
        models: t.models ?? [],
        api: t.openSource === false || (t.tags ?? []).includes("API"),
        date: t.date,
        usage: t.usage,
        tutorial: t.tutorialUrl,
      })),
  }));

  let packs: TemplateLibrary["packs"] = [];
  try {
    const p = await comfyFetch("/workflow_templates", { timeoutMs: 8000 });
    if (p.ok) packs = Object.entries((await p.json()) as Record<string, string[]>).flatMap(([pack, names]) => names.map((name) => ({ pack, name })));
  } catch {
    /* older servers have no pack templates */
  }
  cache = { at: Date.now(), id: connectionId(), lib: { categories, packs } };
  return cache.lib;
}

/** One template's workflow JSON: a core template by name, or a node pack's example. */
export async function templateJson(name: string, pack?: string): Promise<unknown> {
  if (!SAFE_NAME.test(name) || (pack && !SAFE_NAME.test(pack))) throw new Error(say("That isn't a template name."));
  const paths: [string, boolean][] = pack
    ? [[`/api/workflow_templates/${pack}/${name}.json`, false], [`/workflow_templates/${pack}/${name}.json`, false]]
    : [[`/templates/${name}.json`, true]];
  for (const [p, raw] of paths) {
    const res = await comfyFetch(p, { raw });
    if (res.ok) return res.json();
  }
  throw new Error(
    pack
      ? say("ComfyUI lists “{name}” from {pack} but won't hand out the file. Open it in ComfyUI, save it, and pick it under Saved in ComfyUI.", { name, pack })
      : say("ComfyUI couldn't open the template “{name}”.", { name }),
  );
}

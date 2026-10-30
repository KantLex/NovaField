"use client";

// The Image page's working state: the picture being worked on, each tool's settings, and the
// helpers that open a picture there, follow its history and make more versions of a take.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Aspect, Asset, ImageModel, ImageSpec, ImageTool, JobSpec } from "@/lib/engines/specs";
import { outputOf, type Job } from "@/lib/jobs";
import { randomSeed as fieldSeed } from "@/lib/workflows/apply";
import type { RecipeSummary } from "@/lib/workflows/types";
import { api, fail, toast } from "../api";
import { randomSeed, useLive } from "../state";
import { tr } from "@/i18n";

export interface Lab {
  tool: ImageTool;
  /** A picture that isn't a take (an upload, a video frame, an asset). A focused picture take wins over it. */
  asset: Asset | null;
  edit: string;
  model?: ImageModel;
  scale: number;
  creativity: number;
  /** Upscale: what the picture shows, to guide the new detail. */
  detail: string;
  aspect: Aspect;
  /** Expand: what fills the new space. */
  fill: string;
  /** Versions per run, each with its own seed. */
  count: number;
  set: (p: Partial<Lab>) => void;
}

export const useLab = create<Lab>()(
  persist(
    (set) => ({
      tool: "edit",
      asset: null,
      edit: "",
      scale: 2,
      creativity: 0.35,
      detail: "",
      aspect: "16:9",
      fill: "",
      count: 1,
      set: (p) => set(p),
    }),
    {
      name: "novafield-image",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "set")) as unknown as Lab,
    },
  ),
);

/** Ready-made changes for the edit box, in the words the editing models understand. */
export const EDIT_PRESETS: { label: string; prompt: string }[] = [
  { label: "Night", prompt: "Make it night, lit by street lamps and windows." },
  { label: "Golden hour", prompt: "Relight the scene with warm, low golden-hour sunlight and long soft shadows." },
  { label: "Rain", prompt: "Make it a rainy day: wet reflective ground, falling rain, overcast light." },
  { label: "Winter", prompt: "Change the season to winter, with snow on the ground and on surfaces." },
  { label: "Plain background", prompt: "Replace the background with a plain light grey studio backdrop. Keep the subject exactly as it is." },
  { label: "Remove text", prompt: "Remove all text, logos and watermarks, filling the areas naturally." },
  { label: "Remove people behind", prompt: "Remove the people in the background, filling the space naturally. Keep the main subject." },
  { label: "Anime", prompt: "Redraw it as a hand-painted anime film still. Keep the composition." },
  { label: "Pencil sketch", prompt: "Turn it into a detailed pencil sketch on paper." },
  { label: "Film still", prompt: "Make it look like a 35mm film still: natural grain, soft contrast, cinematic colour." },
];

export const LAB_ASPECTS: Aspect[] = ["16:9", "2.39:1", "9:16", "1:1", "4:3"];

// A take's picture is copied into the ComfyUI input folder once per session, the first time a tool needs it.
const copies = new Map<string, Promise<Asset>>();

/** A picture take (or a video's last frame) as an asset ComfyUI can load. */
export function pictureOf(job: Job): Promise<Asset> {
  let p = copies.get(job.id);
  if (!p) {
    p = (job.video ? api.frame(job.id) : api.useTake(job.id, "image")).then((a) => ({ ...a, label: job.title }));
    p.catch(() => copies.delete(job.id));
    copies.set(job.id, p);
  }
  return p;
}

/** Shows a take's picture on the Image page. */
export function openInLab(job: Job, go: (href: string) => void) {
  useLive.getState().setFocus(job.id);
  if (window.location.pathname !== "/image") go("/image");
}

/** Shows a picture that isn't a take (an upload, a frame) on the Image page. */
export function openAssetInLab(asset: Asset, go: (href: string) => void) {
  useLab.getState().set({ asset });
  useLive.getState().setFocus(null);
  if (window.location.pathname !== "/image") go("/image");
}

/** Runs one tool on a take's picture with the Image page's settings, then shows the result there. */
export async function runTool(job: Job, tool: ImageTool, go: (href: string) => void, patch: Partial<ImageSpec> = {}) {
  try {
    const lab = useLab.getState();
    const image = await pictureOf(job);
    const spec: ImageSpec = { kind: "image", tool, image, prompt: tool === "upscale" ? sceneOf(job, useLive.getState().jobs) : "", scale: lab.scale, creativity: lab.creativity, from: job.id, seed: randomSeed(), ...patch };
    const [made] = await api.submit([spec]);
    toast(tool === "upscale" ? "Upscaling. The new picture appears on the Image page." : "Sent to the GPU.", "done");
    openInLab(made, go);
  } catch (e) {
    fail(e);
  }
}

/** The same job with fresh seeds, for "More like this". Null when the take can't be made again. */
export function respin(spec: JobSpec, recipes: RecipeSummary[]): JobSpec | null {
  switch (spec.kind) {
    case "image":
    case "shot":
      return { ...spec, seed: randomSeed() };
    case "workflow": {
      const recipe = recipes.find((r) => r.id === spec.recipe);
      if (!recipe) return null;
      const seeds = recipe.fields.filter((f) => f.kind === "seed");
      if (!seeds.length) return null;
      return { ...spec, values: { ...spec.values, ...Object.fromEntries(seeds.map((f) => [f.id, fieldSeed(f)])) } };
    }
    default:
      return null;
  }
}

/** Queues `n` more takes like this one, each with its own seed. */
export async function moreLikeThis(job: Job, n: number, recipes: RecipeSummary[]) {
  const specs = Array.from({ length: n }, () => respin(job.spec, recipes)).filter((s): s is JobSpec => !!s);
  if (!specs.length) return toast("This take has no seed to change, so another run would look the same.", "error");
  try {
    const made = await api.submit(specs);
    useLive.getState().setFocus(made[0].id);
    toast(n === 1 ? tr("One more version on its way.") : tr("{n} more versions on their way.", { n }), "done");
  } catch (e) {
    fail(e);
  }
}

/** A picture's history: what it started as, and every step taken from there (oldest first). */
export interface Version {
  key: string;
  job?: Job;
  /** The upload or frame it started from, when that isn't a take. */
  asset?: Asset;
}

/** A take that is (or will be) a picture. */
export const isPicture = (j: Job) => outputOf(j) === "image" || j.kind === "image";

/** The take a picture's history starts from (`job:<id>`), or the upload it started from (`asset:<name>`). */
export function rootOf(job: Job, jobs: Record<string, Job>): string {
  let j = job;
  const seen = new Set<string>();
  while (j.spec.kind === "image" && j.spec.from && jobs[j.spec.from] && !seen.has(j.id)) {
    seen.add(j.id);
    j = jobs[j.spec.from];
  }
  return j.spec.kind === "image" && !j.spec.from ? `asset:${j.spec.image.name}` : `job:${j.id}`;
}

/** Every version of the picture on show, starting with the original. */
export function versions(jobs: Record<string, Job>, current: Job | null, asset: Asset | null): Version[] {
  const root = current ? rootOf(current, jobs) : asset ? `asset:${asset.name}` : null;
  if (!root) return [];
  const steps = Object.values(jobs)
    .filter((j) => j.kind === "image" && rootOf(j, jobs) === root)
    .sort((a, b) => a.createdAt - b.createdAt);
  const head: Version | null = root.startsWith("job:")
    ? jobs[root.slice(4)] && { key: root, job: jobs[root.slice(4)] }
    : { key: root, asset: asset?.name === root.slice(6) ? asset : steps[0]?.spec.kind === "image" ? steps[0].spec.image : undefined };
  return [...(head && (head.job || head.asset) ? [head] : []), ...steps.map((j) => ({ key: j.id, job: j }))];
}

/**
 * What a picture shows, in words, to guide an upscale's new detail: its own prompt, or for a step
 * (whose prompt is an instruction like "make it night") the prompt of the take it started from.
 */
export function sceneOf(job: Job, jobs: Record<string, Job>): string {
  if (job.kind !== "image") return job.meta?.prompt ?? "";
  const root = rootOf(job, jobs);
  return root.startsWith("job:") ? (jobs[root.slice(4)]?.meta?.prompt ?? "") : "";
}

/** The picture a tool step started from, to compare the result against. */
export function beforeOf(job: Job, jobs: Record<string, Job>): string | null {
  if (job.spec.kind !== "image") return null;
  const parent = job.spec.from ? jobs[job.spec.from] : null;
  return parent?.image ?? parent?.poster ?? job.spec.image.url;
}

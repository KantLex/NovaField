// Turns a JobSpec into a render: prepare inputs, compile, preflight, queue, follow progress,
// then bring the finished take home (video, poster, filmstrip) for the library.

import { checkQuietly } from "./qc";
import { LOOKS } from "@/lib/cinema/looks";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { ApiGraph } from "@/lib/comfy/graph";
import { priceGraph } from "@/lib/comfy/pricing";
import { apiNodes, errorsOf, prune, validateGraph, warningsOf, type ObjectInfo } from "@/lib/comfy/validate";
import { blocker, compile, recipeIdOf, type CompileContext } from "@/lib/engines";
import { detectCapabilities, type Capabilities } from "@/lib/engines/capabilities";
import type { JobSpec } from "@/lib/engines/specs";
import { isLive, titleFor, type Job } from "@/lib/jobs";
import { cancelPrompt, history, mainOutput, objectInfo, queuePrompt, queueState, upload, viewPath } from "./comfy";
import { DRY_RUN } from "./config";
import { comfyFile, partnerKey } from "./connection";
import { HUB, type ComfyEvent } from "./hub";
import { dirs, ensureDirs, filmstrip, placeholder, poster, tail } from "./media";
import { getRecipe } from "./recipes";
import { STORE } from "./store";
import { say } from "@/lib/say";

const STAGES: [RegExp, string][] = [
  [/Loader|LoraLoader/, "Loading models"],
  [/^(LoadImage|LoadVideo|GetVideoComponents|CLIPVisionEncode)$/, "Reading references"],
  [/^NovaGhostRig$/, "Rendering the previs"],
  [/^NovaBoxTrackMask$/, "Tracking the box"],
  [/MiniMaxH3|CLIPTextEncode|WanVace|WanMove|PrimitiveString/, "Reading the script"],
  [/^(SamplerCustomAdvanced|KSampler)$/, "Rendering"],
  [/^VAEDecodeAudio$/, "Mixing sound"],
  [/^VAEDecode/, "Developing"],
  [/^NovaLensFilm$/, "Grading the film"],
  [/^FrameInterpolate$/, "Smoothing motion"],
  [/^(CreateVideo|SaveVideo|TrimVideoLatent)$/, "Printing"],
];

const stageOf = (classType: string) => STAGES.find(([re]) => re.test(classType))?.[1] ?? "Working";
const SAMPLERS = new Set(["SamplerCustomAdvanced", "KSampler"]);

export const FULL_CAPS: Capabilities = {
  h3: true,
  h3Ref: true,
  h3Turbo: true,
  h3RefTurbo: true,
  interpolate: true,
  vace: true,
  wanMove: true,
  causvid: true,
  pack: { ghostRig: true, lensFilm: true, boxTrack: true, contactSheet: true, matchColor: true, shutter: true, shotQc: true, filmLooks: LOOKS.map((l) => l.id), filmControls: true },
  image: { qwen: true, kontext: true, upscale: true, plainAttention: true },
};

async function liveInfo(): Promise<ObjectInfo | null> {
  try {
    return await objectInfo();
  } catch {
    return null;
  }
}

export async function capabilities(): Promise<{ caps: Capabilities; info: ObjectInfo | null }> {
  const info = await liveInfo();
  return { caps: info ? detectCapabilities(info) : DRY_RUN ? FULL_CAPS : detectCapabilities({}), info };
}

/** Load the imported workflow a job runs through, if any. */
export async function contextFor(spec: JobSpec): Promise<CompileContext> {
  const rid = recipeIdOf(spec);
  return rid ? { recipes: { [rid]: await getRecipe(rid) } } : {};
}

/** Compile without queueing, for "View graph" and the preflight panel. */
/**
 * API nodes run on paid cloud services billed to the Comfy account, and need its key. Returns the
 * node types involved and, when no key is configured, why the job can't run.
 */
function paidCheck(graph: ApiGraph, info: ObjectInfo | null): { paid: string[]; blocker: string | null } {
  const paid = info ? apiNodes(graph, info) : [];
  if (!paid.length || partnerKey() || DRY_RUN) return { paid, blocker: null };
  return {
    paid,
    blocker: say(
      "This workflow uses ComfyUI API nodes ({nodes}), which run on paid services billed to your Comfy account. Create an API key at platform.comfy.org and add it on the Connection screen (click the server status at the top right).",
      { nodes: paid.join(", ") },
    ),
  };
}

export async function preflight(spec: JobSpec) {
  const { caps, info } = await capabilities();
  const ctx = await contextFor(spec);
  const why = blocker(spec, caps, ctx);
  if (why && recipeIdOf(spec) && !ctx.recipes?.[recipeIdOf(spec)!]) return { compiled: null, issues: [], warnings: [], paid: [], price: null, blocker: why };
  const compiled = compile(spec, caps, ctx);
  const all = info && !why ? validateGraph(compiled.graph, info) : [];
  const money = paidCheck(compiled.graph, info);
  const price = info && money.paid.length ? await priceGraph(compiled.graph, info).catch(() => null) : null;
  // An imported workflow may use paid API nodes; without the server's node list that can't be told.
  const unpriced = !info && !DRY_RUN && !!recipeIdOf(spec);
  return { compiled, issues: errorsOf(all), warnings: warningsOf(all), paid: money.paid, price, blocker: why ?? money.blocker, unpriced };
}

export async function submit(spec: JobSpec, project?: string): Promise<Job> {
  const rid = recipeIdOf(spec);
  const recipe = rid ? await getRecipe(rid) : null;
  const job: Job = {
    id: randomUUID().slice(0, 8),
    kind: spec.kind,
    title: titleFor(spec, recipe ?? undefined),
    spec,
    status: "preparing",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { stage: "Preparing", pct: 0 },
    dryRun: DRY_RUN,
    ...(project ? { project } : {}),
  };
  await STORE.put(job);
  void run(job.id).catch((e: unknown) =>
    STORE.patch(job.id, { status: "failed", error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() }),
  );
  return job;
}

async function run(id: string) {
  await ensureDirs();
  const job = (await STORE.get(id))!;
  const spec = job.spec;

  if (spec.kind === "shot" && spec.extend && !spec.extend.tail && !spec.engine) {
    await STORE.patch(id, { progress: { stage: "Cutting the previous take's tail", pct: 0.02 } });
    const prev = await STORE.get(spec.extend.fromJob);
    const prevFile = path.join(dirs.media, `${spec.extend.fromJob}.mp4`);
    if (!prev || !existsSync(prevFile)) throw new Error(say("The take to continue from is no longer on disk. Pick another take."));
    const tailFile = path.join(dirs.media, `${id}_tail.mp4`);
    await tail(prevFile, tailFile, spec.extend.overlapFrames);
    const name = DRY_RUN ? `nf_${id}_tail.mp4` : await upload(new Blob([await readFile(tailFile)]), `nf_${id}_tail.mp4`);
    spec.extend.tail = { name, kind: "video", url: `/api/files/media/${id}_tail.mp4`, frames: spec.extend.overlapFrames, fps: 24 };
  }

  const { caps, info } = await capabilities();
  const ctx = await contextFor(spec);
  const why = blocker(spec, caps, ctx);
  if (why) throw new Error(why);
  const compiled = compile(spec, caps, ctx);
  // Queue only what feeds an output, as ComfyUI would run it anyway.
  if (info) compiled.graph = prune(compiled.graph, info);
  STORE.setGraph(id, compiled.graph);
  if (info) {
    const issues = errorsOf(validateGraph(compiled.graph, info));
    if (issues.length) throw new Error(issues.map((i) => `${i.classType}${i.input ? `.${i.input}` : ""}: ${i.message}`).join("\n"));
  }
  const money = paidCheck(compiled.graph, info);
  if (money.blocker) throw new Error(money.blocker);
  await STORE.patch(id, { spec, meta: compiled.meta });

  if (DRY_RUN) return simulate(id, compiled.graph);

  // Cancelled while it was being prepared: stop here, before it reaches the GPU.
  if ((await STORE.get(id))?.status === "cancelled") return;
  const { prompt_id } = await queuePrompt(compiled.graph, HUB.clientId);
  // Cancelled while it was being queued: take our own prompt back off the server.
  if ((await STORE.get(id))?.status === "cancelled") {
    await cancelPrompt(prompt_id).catch(() => {});
    await STORE.patch(id, { promptId: prompt_id });
    return;
  }
  await STORE.patch(id, { status: "queued", promptId: prompt_id, progress: { stage: "Waiting for the GPU", pct: 0.01 } });
  follow(id, prompt_id, compiled.graph);
}

const following = new Set<string>();
const landing = new Set<string>();

/** Brings a finished take home once, however many times its end is seen; a failure fails the take. */
function land(id: string, promptId: string) {
  if (landing.has(id)) return;
  landing.add(id);
  void finalize(id, promptId)
    .catch((e: unknown) =>
      STORE.patch(id, {
        status: "failed",
        error: say("The render finished, but bringing it home failed: {why}", { why: e instanceof Error ? e.message : String(e) }),
        finishedAt: Date.now(),
      }),
    )
    .finally(() => landing.delete(id));
}

function follow(id: string, promptId: string, graph: ApiGraph) {
  if (following.has(id)) return;
  following.add(id);
  const total = Object.keys(graph).length;
  const done = new Set<string>();
  let sampling = false;
  let finished = false;

  // ComfyUI can report progress many times a second (sampler steps, tiled decodes). Each update is
  // a disk write and a message to every open tab, so a stage change goes out at once and steps
  // within a stage at most every 250 ms.
  let last = { stage: "", at: 0 };
  const progress = (stage: string, extra: Partial<Job["progress"]> = {}) => {
    const now = Date.now();
    if (stage === last.stage && now - last.at < 250 && extra.step !== extra.steps) return;
    last = { stage, at: now };
    const before = Math.min(1, done.size / Math.max(1, total * 0.6));
    const pct = sampling ? 0.12 + 0.7 * ((extra.step ?? 0) / Math.max(1, extra.steps ?? 1)) : done.size === 0 ? 0.02 : Math.min(0.12, 0.12 * before);
    return STORE.patch(id, { status: "running", progress: { stage, pct: Math.max(pct, 0.02), ...extra } });
  };

  const stop = HUB.on(promptId, (e: ComfyEvent) => {
    switch (e.type) {
      case "execution_start":
        void STORE.patch(id, { status: "running", startedAt: Date.now(), ahead: 0 });
        break;
      case "execution_cached":
        e.data.nodes.forEach((n) => done.add(n));
        break;
      case "executing": {
        if (!e.data.node) break;
        const cls = graph[e.data.node]?.class_type ?? "";
        done.add(e.data.node);
        if (SAMPLERS.has(cls)) sampling = true;
        else if (sampling) {
          sampling = false;
          void STORE.patch(id, { status: "running", progress: { stage: stageOf(cls), pct: 0.86 } });
          break;
        }
        void progress(stageOf(cls));
        break;
      }
      case "progress": {
        const cls = graph[e.data.node]?.class_type ?? "";
        if (SAMPLERS.has(cls)) void progress("Rendering", { step: e.data.value, steps: e.data.max });
        break;
      }
      case "execution_success":
        end();
        land(id, promptId);
        break;
      case "execution_error":
        end();
        void STORE.patch(id, { status: "failed", error: `${e.data.node_type}: ${e.data.exception_message}`, finishedAt: Date.now() });
        break;
      case "execution_interrupted":
        end();
        void STORE.patch(id, { status: "cancelled", finishedAt: Date.now() });
        break;
    }
  });

  // Safety net for missed WebSocket messages (reconnects, app restarts) + queue position.
  const poll = setInterval(async () => {
    if (finished) return;
    try {
      const h = await history(promptId);
      // The WebSocket may have settled it while this tick was waiting.
      if (finished) return;
      if (h?.status?.completed) {
        end();
        land(id, promptId);
        return;
      }
      if (h?.status?.status_str === "cancelled") {
        end();
        void STORE.patch(id, { status: "cancelled", finishedAt: Date.now() });
        return;
      }
      if (h?.status?.status_str === "error") {
        end();
        const msg = h.status.messages?.find(([k]) => k === "execution_error")?.[1] as { exception_message?: string } | undefined;
        void STORE.patch(id, { status: "failed", error: msg?.exception_message ?? say("The render failed on the server."), finishedAt: Date.now() });
        return;
      }
      const q = await queueState();
      const job = await STORE.get(id);
      if (finished) return;
      // Settled elsewhere (cancelled by the person, failed, finished): nothing left to follow.
      if (!job || !isLive(job)) {
        end();
        return;
      }
      const pending = [...q.queue_pending].sort((a, b) => a[0] - b[0]);
      const pos = pending.findIndex((p) => p[1] === promptId);
      if (pos >= 0 && job.status === "queued" && job.ahead !== pos + q.queue_running.length) {
        await STORE.patch(id, { ahead: pos + q.queue_running.length });
      }
      if (pos < 0 && !q.queue_running.some((r) => r[1] === promptId) && !h) {
        // It may have finished between the two reads: look once more before calling it removed.
        const again = await history(promptId);
        if (finished) return;
        if (again?.status?.completed) {
          end();
          land(id, promptId);
          return;
        }
        if (!again) {
          // Gone from the queue without a history entry: someone cleared it.
          end();
          void STORE.patch(id, { status: "cancelled", error: say("The prompt was removed from the server queue."), finishedAt: Date.now() });
        }
      }
    } catch {
      /* server unreachable for a moment; keep waiting */
    }
  }, 4000);

  function end() {
    finished = true;
    stop();
    clearInterval(poll);
    following.delete(id);
  }
}

async function finalize(id: string, promptId: string) {
  const job = await STORE.get(id);
  if (!job || job.status === "done") return;
  await STORE.patch(id, { progress: { stage: "Bringing the take home", pct: 0.97 } });
  const h = await history(promptId);
  const out = h && mainOutput(h);
  if (!out) {
    await STORE.patch(id, { status: "failed", error: say("The render finished but saved no video, image or audio."), finishedAt: Date.now() });
    return;
  }
  const res = await comfyFile(viewPath(out.file));
  if (!res.ok || !res.body) throw new Error(say("Could not download {file} ({status}).", { file: out.file.filename, status: res.status }));
  const ext = path.extname(out.file.filename).toLowerCase() || (out.kind === "video" ? ".mp4" : out.kind === "image" ? ".png" : ".flac");
  const file = path.join(dirs.media, out.kind === "video" ? `${id}.mp4` : `${id}${ext}`);
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(file));
  if (out.kind === "video") return publish(id, file);
  await STORE.patch(id, {
    status: "done",
    finishedAt: Date.now(),
    progress: { stage: "Wrapped", pct: 1 },
    ...(out.kind === "image" ? { image: `/api/files/media/${path.basename(file)}`, poster: `/api/files/media/${path.basename(file)}` } : { audio: `/api/files/media/${path.basename(file)}` }),
  });
}

async function publish(id: string, file: string) {
  const job = (await STORE.get(id))!;
  const posterFile = path.join(dirs.media, `${id}.jpg`);
  const stripFile = path.join(dirs.media, `${id}_strip.jpg`);
  await poster(file, posterFile, Math.min(1, (job.meta?.seconds ?? 2) / 3)).catch(() => {});
  await filmstrip(file, stripFile, job.meta?.frames ?? 120).catch(() => {});
  await STORE.patch(id, {
    status: "done",
    finishedAt: Date.now(),
    progress: { stage: "Wrapped", pct: 1 },
    video: `/api/files/media/${id}.mp4`,
    poster: existsSync(posterFile) ? `/api/files/media/${id}.jpg` : undefined,
    strip: existsSync(stripFile) ? `/api/files/media/${id}_strip.jpg` : undefined,
  });
  void checkQuietly(id);
}

async function simulate(id: string, graph: ApiGraph) {
  const job = (await STORE.get(id))!;
  const order = Object.values(graph).map((n) => n.class_type);
  await STORE.patch(id, { status: "queued", progress: { stage: "Waiting for the GPU", pct: 0.01 }, ahead: 1 });
  await sleep(1200);
  await STORE.patch(id, { status: "running", startedAt: Date.now(), ahead: 0 });
  for (const cls of order.filter((c) => !SAMPLERS.has(c) && !/Decode|Save|Create|Film|Interp/.test(c)).slice(0, 6)) {
    await STORE.patch(id, { progress: { stage: stageOf(cls), pct: 0.06 } });
    await sleep(350);
  }
  const steps = order.includes("KSampler") ? 8 : 8;
  for (let s = 1; s <= steps; s++) {
    if ((await STORE.get(id))?.status === "cancelled") return;
    await STORE.patch(id, { progress: { stage: "Rendering", pct: 0.12 + 0.7 * (s / steps), step: s, steps } });
    await sleep(700);
  }
  for (const stage of ["Developing", ...(order.includes("NovaLensFilm") ? ["Grading the film"] : []), "Printing"]) {
    await STORE.patch(id, { progress: { stage, pct: 0.9 } });
    await sleep(500);
  }
  const m = job.meta!;
  const w = m.width > 0 ? Math.min(m.width, 960) : 864;
  const h = m.width > 0 && m.height > 0 ? Math.round((w * m.height) / m.width / 2) * 2 : 480;
  const seed = "seed" in job.spec ? job.spec.seed : Math.floor(Math.random() * 1000);
  const rid = recipeIdOf(job.spec);
  const output = rid ? (await getRecipe(rid))?.output : "video";
  const clip = path.join(dirs.media, `${id}.mp4`);
  await placeholder(clip, { width: w - (w % 2), height: h, seconds: Math.max(1, Math.min(m.seconds || 4, 8)), fps: 24, seed });
  if (output === "image") {
    const still = path.join(dirs.media, `${id}.jpg`);
    await poster(clip, still, 0.5);
    const { rm } = await import("node:fs/promises");
    await rm(clip, { force: true });
    await STORE.patch(id, { status: "done", finishedAt: Date.now(), progress: { stage: "Wrapped", pct: 1 }, image: `/api/files/media/${id}.jpg`, poster: `/api/files/media/${id}.jpg` });
    return;
  }
  await publish(id, clip);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A cancel the server can't carry out without touching other work. */
export class CancelRefused extends Error {}

export async function cancel(id: string) {
  const job = await STORE.get(id);
  if (!job || !isLive(job)) return job;
  if (job.promptId && !DRY_RUN) {
    const r = await cancelPrompt(job.promptId);
    if (r === "interrupted") return job; // the interrupted event marks it
    if (r === "not-found" && job.status === "running") {
      throw new CancelRefused(say("This take is already rendering and can't be stopped on its own here. It will finish shortly."));
    }
  }
  return STORE.patch(id, { status: "cancelled", finishedAt: Date.now() });
}

let resumed = false;
const STARTED = Date.now();
/** After an app restart, pick up prompts that were still on the server. */
export async function resumeLive() {
  if (resumed || DRY_RUN) return;
  resumed = true;
  for (const job of await STORE.all()) {
    if (!isLive(job)) continue;
    const graph = STORE.graph(job.id);
    if (job.promptId) follow(job.id, job.promptId, graph ?? {});
    else if (job.createdAt < STARTED) await STORE.patch(job.id, { status: "failed", error: say("The app restarted before this job reached the server."), finishedAt: Date.now() });
  }
}

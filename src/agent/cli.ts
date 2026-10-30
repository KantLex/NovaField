// NovaField from the terminal, on the same client as the MCP server: everything an agent can do
// through MCP, plus Image, Grade and Shot QC. Renders only plan (and print the price) until
// --max-credits is given, exactly like the MCP tools.
//
//   pnpm novafield status
//   pnpm novafield shot "a lighthouse keeper climbs the stairs" --move crane_up --lens 35            (plan only)
//   pnpm novafield shot "…" --move push_in --lens 35 --max-credits 20 --wait                       (render)
//   pnpm novafield recast take:a1b2c3d4 --character asset:c0ffee00 --max-credits 0 --wait --save out/
//   pnpm novafield qc 1f2e3d4c
//   pnpm novafield film --project "Night Shoot" --title "Cut 1"

import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { LOOKS } from "@/lib/cinema/looks";
import { parseRigFile } from "@/lib/cinema/rigFile";
import type { Lens, MoveLayer } from "@/lib/cinema/moves";
import { creditsOf } from "@/lib/comfy/budget";
import type { Asset, FilmLab, GradeSpec, ImageModel, ImageSpec, ImageTool, JobSpec, Quality } from "@/lib/engines/specs";
import { isLive, type Job } from "@/lib/jobs";
import { UNSORTED } from "@/lib/projects";
import { QC_LABEL, issueTime } from "@/lib/qc";
import type { AssetKind } from "@/lib/assets";
import { isEngine } from "@/lib/workflows/apply";
import { parseBox, parseClip, parseFrameMove, parsePairs, parsePath, parseRef } from "./cliArgs";
import { NovaError, NovaField, type Preflight } from "./client";
import { pathsSpec, recastSpec, replaceSpec, restyleSpec, type Sound } from "./henshin";
import { repoFile } from "./paths";
import { ASPECTS, DEFAULT_FILM, buildShot, checkShot, describeFields, randomSeed, workflowSpec, workflowValues, type ShotOptions } from "./shot";
import { cameraVocabulary } from "./vocabulary";

const HELP = `novafield <command> [options]

Server
  status                              Server, GPU, queue, API key
  engines [--fields]                  The built-in engine and imported workflows (local / API, paid)
  moves                               Every camera move, shot size, angle, lens, light and film look

Make (each one plans and prints the price; add --max-credits <n> to render, 0 = local GPU only)
  shot "<prompt>"                     A shot with real camera direction
      --move <id> | --combo <id[:intensity[:whole|start|end]]>… | --rig-file <path>
      --lens <mm> --size <id> --angle <id> --lighting <id> --look <id> --intensity <n> --shake <0-1>
      --aspect 16:9 --quality draft|studio|master --duration <s> --seed <n> --camera rig|prompt --silent --smooth
      --cast <picture>…  --start-frame <picture>  --end-frame <picture>  --previs <clip> [--previs-action]
      --continue <take>  --engine <workflow id>  --takes <n>
  recast <clip> --character <picture> [--extra <picture>…] [--notes "…"]         Swap the person (Henshin)
  restyle <clip> [--style "…"] [--style-picture <picture>] [--look <id>]          Re-render in a new look
  replace <clip> --box x,y,w,h[@s]… (--becomes "…" | --picture <picture>) [--shape ellipse]
  animate <picture> [--path "x,y x,y[@start-end][:ease]"…] [--frame-move pan_left[:0.15]] [--prompt "…"]
      Henshin options: --audio original|generated|none  --quality <q>  --seed <n>
  image edit <picture> "<change>" [--model qwen|kontext]                         Change a picture in words
  image upscale <picture> [--scale 1.5-2] [--creativity 0-1] [--prompt "what it shows"]
  image expand <picture> --aspect 16:9 ["what fills the new space"]
  grade <take> [--look <id>] [--strength 0-1] [--grain --halation --vignette 0-1]
               [--match <take|picture>] [--match-amount 0-1] [--colour-only] [--shutter 0-360] [--speed 0.25-2]
  run <workflow> [--role prompt="…"]… [--field 3.text=…]… [--file image=./a.png]…   An imported workflow
      Shared: --max-credits <n>  --project <id|name>  --wait  --save <file|dir>

Check
  qc <take>                           Shot QC: frozen, flickering, jumping or soft frames, with times

Library
  takes [--project] [--status] [--kind] [--starred] [--query] [--limit]
  take <id> [--wait] [--save <file|dir>]
  cancel <id>                         Cancel a take you started (only its own prompt is removed)
  frame <take> [--at <s>] [--save <file|dir>]   Save one frame as a picture
  move <take>… --project <id|name|unsorted> [--create]
  star <take>… [--off]
  projects
  assets [--kind]
  asset <id> <file|url>…              Add pictures or clips to an asset
  asset --name "…" --kind character|object|location|style|clip [--description "…"] <file|url>…

Workflows
  find-workflows ["words"] [--media image|video|audio|3d] [--local-only] [--limit]
  import <file.json | template:<name> | saved:<path>> [--name "…"]

Edit
  edit [--project]                    The project's edit
  edit set <clip>… [--append] [--project]      Clips: <take>[:in-out][:cut|dissolve][!] (! mutes)
  film [--project] [--title] [--soundtrack <file> [--music-start <s>] [--mix replace|under] [--volume 0-1]]
  setup                               How to connect an AI agent (any MCP client) to NovaField

Pictures and clips: asset:<id>, take:<id>[@seconds], a file path, or a bare take or asset id.
NOVAFIELD_URL overrides http://localhost:4317. Add --json for machine-readable output.`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    // Shots
    move: { type: "string" },
    combo: { type: "string", multiple: true },
    "rig-file": { type: "string" },
    lens: { type: "string" },
    size: { type: "string" },
    angle: { type: "string" },
    aspect: { type: "string" },
    quality: { type: "string" },
    duration: { type: "string" },
    look: { type: "string" },
    lighting: { type: "string" },
    intensity: { type: "string" },
    shake: { type: "string" },
    seed: { type: "string" },
    camera: { type: "string" },
    silent: { type: "boolean" },
    smooth: { type: "boolean" },
    engine: { type: "string" },
    cast: { type: "string", multiple: true },
    "start-frame": { type: "string" },
    "end-frame": { type: "string" },
    previs: { type: "string" },
    "previs-action": { type: "boolean" },
    continue: { type: "string" },
    takes: { type: "string" },
    // Henshin
    character: { type: "string" },
    extra: { type: "string", multiple: true },
    notes: { type: "string" },
    style: { type: "string" },
    "style-picture": { type: "string" },
    audio: { type: "string" },
    box: { type: "string", multiple: true },
    shape: { type: "string" },
    becomes: { type: "string" },
    picture: { type: "string" },
    path: { type: "string", multiple: true },
    "frame-move": { type: "string" },
    prompt: { type: "string" },
    // Image and grade
    model: { type: "string" },
    scale: { type: "string" },
    creativity: { type: "string" },
    strength: { type: "string" },
    grain: { type: "string" },
    halation: { type: "string" },
    vignette: { type: "string" },
    match: { type: "string" },
    "match-amount": { type: "string" },
    "colour-only": { type: "boolean" },
    shutter: { type: "string" },
    speed: { type: "string" },
    // Workflows
    role: { type: "string", multiple: true },
    field: { type: "string", multiple: true },
    file: { type: "string", multiple: true },
    fields: { type: "boolean" },
    media: { type: "string" },
    "local-only": { type: "boolean" },
    name: { type: "string" },
    // Rendering
    "max-credits": { type: "string" },
    project: { type: "string" },
    wait: { type: "boolean" },
    save: { type: "string" },
    // Library and edit
    status: { type: "string" },
    kind: { type: "string" },
    starred: { type: "boolean" },
    query: { type: "string" },
    limit: { type: "string" },
    at: { type: "string" },
    create: { type: "boolean" },
    off: { type: "boolean" },
    description: { type: "string" },
    append: { type: "boolean" },
    title: { type: "string" },
    soundtrack: { type: "string" },
    "music-start": { type: "string" },
    mix: { type: "string" },
    volume: { type: "string" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const nova = new NovaField();
const num = (v: string | undefined) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  // A typo must not slip through as NaN (it would reach the server as null and mean "default").
  if (v.trim() === "" || !Number.isFinite(n)) throw new NovaError(`"${v}" isn't a number.`);
  return n;
};
const out = (human: string, data: unknown) => console.log(o.json ? JSON.stringify(data, null, 2) : human);
const note = (s: string) => {
  if (!o.json) console.error(s);
};
const arg = (i: number, what: string) => {
  const v = positionals[i];
  if (!v) throw new NovaError(`${what}\n\nnovafield --help lists every command.`);
  return v;
};

function line(j: Job) {
  const where = isLive(j) ? `${j.progress.stage} ${Math.round(j.progress.pct * 100)}%` : j.status;
  const file = nova.absolute(j.video ?? j.image ?? j.audio);
  return `${j.id}  ${where.padEnd(14)} ${j.title}${file && j.status === "done" ? `\n          ${file}` : ""}${j.error ? `\n          ${j.error}` : ""}`;
}

async function project(p: string | undefined) {
  if (!p) return null;
  const found = await nova.findProject(p);
  if (!found) throw new NovaError(`No project "${p}". novafield projects lists them.`);
  return found.id;
}

// Pictures and clips

/** A take or an asset with this id, whichever exists (takes first). */
async function either(id: string): Promise<{ take: Job } | { asset: string }> {
  const take = await nova.take(id).catch(() => null);
  if (take) return { take };
  if ((await nova.assets()).some((a) => a.id === id)) return { asset: id };
  throw new NovaError(`No take or asset "${id}".`);
}

async function picture(s: string): Promise<Asset> {
  const ref = parseRef(s);
  const fromTake = async (t: Job, at?: number) => (t.video ? nova.frame(t.id, at) : nova.useTake(t.id, "image"));
  switch (ref.from) {
    case "asset": {
      const [first] = (await nova.useAsset(ref.id, "image")).filter((a) => a.kind === "image");
      if (!first) throw new NovaError(`Asset ${ref.id} has no picture.`);
      return first;
    }
    case "take":
      return fromTake(await nova.take(ref.id), ref.at);
    case "file":
      return nova.upload(ref.path, "image");
    case "id": {
      const found = await either(ref.id);
      return "take" in found ? fromTake(found.take, ref.at) : picture(`asset:${found.asset}`);
    }
  }
}

async function clip(s: string, purpose: "h3" | "wan"): Promise<Asset> {
  const ref = parseRef(s);
  const fromAsset = async (id: string) => {
    const found = (await nova.useAsset(id, purpose)).find((a) => a.kind === "video");
    if (!found) throw new NovaError(`Asset ${id} has no video clip.`);
    return found;
  };
  switch (ref.from) {
    case "asset":
      return fromAsset(ref.id);
    case "take":
      return nova.useTake(ref.id, purpose);
    case "file":
      return nova.upload(ref.path, purpose);
    case "id": {
      const found = await either(ref.id);
      return "take" in found ? nova.useTake(found.take.id, purpose) : fromAsset(found.asset);
    }
  }
}

// Planning, rendering, waiting

function price(plan: Preflight) {
  const cr = creditsOf(plan);
  return "unknown" in cr ? `unknown (${cr.unknown})` : cr.max === 0 ? "0 credits (local GPU)" : cr.min === cr.max ? `${cr.max} credits` : `${cr.min}–${cr.max} credits`;
}

function planLines(plan: Preflight, first: string[] = []) {
  const m = plan.meta;
  return [
    ...first,
    m ? `Makes: ${m.output === "image" ? `a ${m.width}×${m.height} picture` : `${m.seconds.toFixed(1)} s at ${m.width}×${m.height}, ${m.fps} fps`}` : "",
    m?.engine ? `Engine: ${m.engine}` : "",
    `Cost: ${price(plan)}`,
    ...(plan.blocker ? [`Blocked: ${plan.blocker}`] : []),
    ...plan.issues.map((i) => `Problem: ${i.classType}${i.input ? `.${i.input}` : ""}: ${i.message}`),
    ...plan.warnings.map((w) => `Warning: ${w.classType}: ${w.message}`),
    ...(m?.notes ?? []).map((n) => `Note: ${n}`),
  ].filter(Boolean);
}

/** Waits for a take, showing its progress on one line of the terminal. */
async function follow(id: string, timeoutMs = 60 * 60_000): Promise<Job> {
  const t0 = Date.now();
  const tty = process.stderr.isTTY && !o.json;
  let last = "";
  let misses = 0;
  for (;;) {
    // A poll can fail while the app restarts or recompiles; the render carries on regardless.
    const j = await nova.take(id).catch((e: unknown) => {
      if (++misses > 5) throw e;
      return null;
    });
    if (!j) {
      await new Promise((r) => setTimeout(r, 2_000));
      continue;
    }
    misses = 0;
    if (!isLive(j)) {
      if (tty && last) process.stderr.write("\r\x1b[2K");
      return j;
    }
    const now = `${j.id}  ${j.progress.stage} ${Math.round(j.progress.pct * 100)}%${j.ahead ? ` (${j.ahead} ahead)` : ""}`;
    if (tty && now !== last) process.stderr.write(`\r\x1b[2K${now}`);
    last = now;
    if (Date.now() - t0 > timeoutMs) throw new NovaError(`Still rendering after ${Math.round(timeoutMs / 60_000)} min: novafield take ${id} --wait`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/**
 * Copies a finished take's file (or a picture) to a file, or into a folder under its own name. With
 * several files (`many`) a file name gets each one's name added, so they don't overwrite each other.
 */
async function save(url: string | undefined, dest: string, name: string, many = false) {
  const src = nova.absolute(url);
  if (!src) throw new NovaError("There's no file to save yet.");
  const ext = path.extname(new URL(src).pathname) || ".bin";
  // Names come from titles: keep them to one plain file name.
  const safe = name.replace(/[/\\\0]+/g, "-").replace(/^\.+/, "").trim() || "take";
  const folder = /[/\\]$/.test(dest) || (existsSync(dest) && statSync(dest).isDirectory());
  let target: string;
  if (folder) target = path.join(dest, `${safe}${ext}`);
  else {
    const own = path.extname(dest) ? dest : `${dest}${ext}`;
    target = many ? own.replace(/(\.[^./\\]+)$/, `_${safe}$1`) : own;
  }
  await mkdir(path.dirname(target), { recursive: true });
  const res = await fetch(src);
  if (!res.ok || !res.body) throw new NovaError(`Couldn't download ${src} (${res.status}).`);
  // Download beside it, then swap in: a failed download never leaves a half-written file in place.
  const part = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
    await rename(part, target);
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
  return path.resolve(target);
}

/** Exit non-zero unless every take finished, so scripts don't carry on without a file. */
const settle = (jobs: Job[]) => {
  if (jobs.some((j) => j.status !== "done" && !isLive(j))) process.exitCode = 1;
};

/** Plan only without --max-credits; otherwise queue, and with --wait follow and --save keep the result. */
async function render(specs: JobSpec[], first: string[] = []) {
  const plans = await Promise.all(specs.map((s) => nova.preflight(s)));
  const plan = plans[0];
  const summary = planLines(plan, first);
  // Several takes cost several times one: show the total, which is what --max-credits must cover.
  if (plans.length > 1) {
    const all = plans.map(creditsOf);
    const unknown = all.find((c) => "unknown" in c);
    if (!unknown) {
      const lo = all.reduce((t, c) => t + ("min" in c ? c.min : 0), 0);
      const hi = all.reduce((t, c) => t + ("max" in c ? c.max : 0), 0);
      const i = summary.findIndex((l) => l.startsWith("Cost: "));
      if (i >= 0 && hi > 0) summary[i] = `Cost: ${lo === hi ? hi : `${Math.round(lo * 10) / 10}–${Math.round(hi * 10) / 10}`} credits for ${plans.length} takes`;
    }
  }
  const max = num(o["max-credits"]);
  if (max === undefined) return out(`${summary.join("\n")}\n\nPlan only. Add --max-credits <n> to render (0 = local GPU only).`, { spec: specs[0], plan });
  if (plan.blocker) throw new NovaError(`${summary.join("\n")}\n\nCan't render this as it is.`);
  const { jobs, budget } = await nova.generate(specs, { maxCredits: max, project: await project(o.project) });
  note(`${summary.join("\n")}\nQueued ${jobs.length} take${jobs.length === 1 ? "" : "s"} (up to ${budget.credits.max} credits).`);
  // The ids go out at once, even with --json (on stderr): if waiting fails, the takes can still be found.
  if (o.json && (o.wait || o.save)) console.error(JSON.stringify({ queued: jobs.map((j) => j.id) }));
  else if (o.wait || o.save) note(`Takes: ${jobs.map((j) => j.id).join(" ")}`);
  const final = o.wait || o.save ? await Promise.all(jobs.map((j) => follow(j.id))) : jobs;
  if (o.save)
    for (const j of final)
      if (j.status === "done")
        await save(j.video ?? j.image ?? j.audio, o.save, j.id, final.length > 1).then(
          (f) => note(`Saved ${f}`),
          (e: unknown) => {
            console.error(`Couldn't save ${j.id}: ${e instanceof Error ? e.message : String(e)}`);
            process.exitCode = 1;
          },
        );
  out(final.map(line).join("\n"), final);
  settle(final);
}

// Make

async function shot() {
  const prompt = positionals.slice(1).join(" ");
  const opts: ShotOptions = {
    prompt,
    move: o.move,
    combo: o.combo?.map((c): MoveLayer => {
      const [id, intensity, when] = c.split(":");
      return { id, intensity: num(intensity) ?? 1, when: (when as MoveLayer["when"]) ?? "whole" };
    }),
    lens: num(o.lens) as Lens | undefined,
    size: o.size as ShotOptions["size"],
    angle: o.angle as ShotOptions["angle"],
    aspect: o.aspect as ShotOptions["aspect"],
    quality: o.quality as ShotOptions["quality"],
    duration: num(o.duration),
    look: o.look as ShotOptions["look"],
    lighting: o.lighting,
    intensity: num(o.intensity),
    shake: num(o.shake),
    seed: num(o.seed),
    cameraMode: o.camera as ShotOptions["cameraMode"],
    sound: o.silent ? false : undefined,
    smooth: o.smooth,
    engine: o.engine,
    continueFrom: o.continue,
  };
  if (o["rig-file"]) {
    const parsed = parseRigFile(await readFile(o["rig-file"], "utf8"));
    if ("error" in parsed) throw new NovaError(parsed.error);
    opts.rig = parsed.rig;
    if (opts.duration === undefined && parsed.seconds) opts.duration = Math.min(15, Math.max(2, Math.round(parsed.seconds * 2) / 2));
  }
  const bad = checkShot(opts);
  if (bad.length) throw new NovaError(bad.join("; "));
  // An asset in --cast (asset:<id>, or a bare id that is one) brings all its pictures; anything else is one picture.
  const castAsset = async (c: string) => {
    const ref = parseRef(c);
    if (ref.from === "asset") return ref.id;
    return ref.from === "id" && (await nova.assets()).some((a) => a.id === ref.id) ? ref.id : null;
  };
  if (o.cast?.length)
    opts.cast = (
      await Promise.all(
        o.cast.map(async (c) => {
          const id = await castAsset(c);
          return id ? (await nova.useAsset(id, "image")).filter((a) => a.kind === "image") : [await picture(c)];
        }),
      )
    )
      .flat()
      .slice(0, 9);
  if (o["start-frame"]) opts.startFrame = await picture(o["start-frame"]);
  if (o["end-frame"]) opts.endFrame = await picture(o["end-frame"]);
  if (o.previs) opts.previs = { clip: await clip(o.previs, "h3"), follow: o["previs-action"] ? "action" : "camera" };
  const spec = buildShot(opts);
  const n = Math.min(4, Math.max(1, num(o.takes) ?? 1));
  const specs = Array.from({ length: n }, (_, i) => (i === 0 ? spec : { ...spec, seed: randomSeed() }));
  return render(specs, [`Shot: ${spec.combo ? "stacked moves" : spec.rig ? "custom rig" : spec.move}, ${spec.lens} mm, ${spec.size}, ${spec.angle}, ${spec.aspect}, ${spec.quality}${n > 1 ? `, ${n} takes` : ""}`]);
}

const henshinCommon = () => ({ audio: (o.audio as Sound) ?? "original", quality: (o.quality as Quality) ?? "draft", seed: num(o.seed) });

async function recast() {
  if (!o.character) throw new NovaError("Who goes in? --character <picture>");
  const [source, character, extras] = await Promise.all([clip(arg(1, "Recast which clip? novafield recast <clip> --character <picture>"), "h3"), picture(o.character), Promise.all((o.extra ?? []).map(picture))]);
  return render([recastSpec({ source, character, extras, notes: o.notes, ...henshinCommon() })], [`Recast: ${source.label ?? source.name} → ${character.label ?? "the character"}`]);
}

async function restyle() {
  const [source, styleRef] = await Promise.all([clip(arg(1, "Restyle which clip? novafield restyle <clip> --style \"…\""), "h3"), o["style-picture"] ? picture(o["style-picture"]) : undefined]);
  return render([restyleSpec({ source, style: o.style, styleRef, look: o.look, ...henshinCommon() })], [`Restyle: ${o.style ?? "in the style picture's look"}`]);
}

async function replace() {
  if (!o.box?.length) throw new NovaError("Where is it? --box x,y,w,h[@seconds] (repeat for something that moves)");
  const [source, replacement] = await Promise.all([clip(arg(1, "Replace in which clip? novafield replace <clip> --box … --becomes \"…\""), "wan"), o.picture ? picture(o.picture) : undefined]);
  return render([replaceSpec({ source, boxes: o.box.map(parseBox), shape: o.shape === "ellipse" ? "ellipse" : "rect", prompt: o.becomes, replacement, seed: num(o.seed) })], [`Replace: ${o.becomes ?? "with the picture"}`]);
}

async function animate() {
  const image = await picture(arg(1, "Animate which picture? novafield animate <picture> --path \"x,y x,y\""));
  return render([pathsSpec({ image, paths: (o.path ?? []).map(parsePath), frame: o["frame-move"] ? parseFrameMove(o["frame-move"]) : undefined, prompt: o.prompt, seed: num(o.seed) })], [`Animate: ${(o.path ?? []).length} path(s)${o["frame-move"] ? `, frame ${o["frame-move"]}` : ""}`]);
}

async function image() {
  const tool = arg(1, "Which tool? novafield image edit|upscale|expand <picture> …") as ImageTool;
  if (!["edit", "upscale", "expand"].includes(tool)) throw new NovaError(`Unknown image tool "${tool}": edit, upscale or expand.`);
  const ref = arg(2, `Which picture? novafield image ${tool} <picture>`);
  const words = positionals.slice(3).join(" ").trim();
  const source = parseRef(ref);
  const take = source.from === "take" || source.from === "id" ? await nova.take(source.id).catch(() => null) : null;
  const pic = await picture(ref);
  if (tool === "edit" && !words) throw new NovaError('Say what to change: novafield image edit <picture> "make it night"');
  if (tool === "expand" && !o.aspect) throw new NovaError(`Expand to which shape? --aspect ${ASPECTS.join("|")}`);
  // Like the Image page: an upscale is guided by what the picture shows, the take's own prompt unless given.
  const prompt = tool === "upscale" ? (o.prompt ?? (words || take?.meta?.prompt || "")) : words;
  const spec: ImageSpec = {
    kind: "image",
    tool,
    image: pic,
    prompt,
    ...(tool !== "upscale" && o.model ? { model: o.model as ImageModel } : {}),
    scale: num(o.scale) ?? 2,
    creativity: num(o.creativity) ?? 0.35,
    ...(o.aspect ? { aspect: o.aspect as ImageSpec["aspect"] } : {}),
    ...(take ? { from: take.id } : {}),
    seed: num(o.seed) ?? randomSeed(),
  };
  return render([spec], [`Image ${tool}${prompt ? `: ${prompt}` : ""}`]);
}

async function grade() {
  const id = arg(1, "Grade which take? novafield grade <take> --look kodak_2383");
  const job = await nova.take(id);
  if (!job.video) throw new NovaError("Only finished video takes can be graded.");
  const look = LOOKS.find((l) => l.id === (o.look ?? "none"));
  if (!look) throw new NovaError(`Unknown look "${o.look}" (novafield moves lists them).`);
  // A look starts with its own grain, halation and vignette, as in the Grade sheet.
  const film: FilmLab = {
    ...DEFAULT_FILM,
    look: look.id,
    intensity: num(o.strength) ?? DEFAULT_FILM.intensity,
    grain: num(o.grain) ?? look.grain,
    halation: num(o.halation) ?? look.halation,
    vignette: num(o.vignette) ?? look.vignette,
    chromatic: 0,
    gateWeave: 0,
  };
  let match: GradeSpec["match"];
  if (o.match) {
    const ref = parseRef(o.match);
    // A take stands in by its middle frame, as in the Grade sheet.
    const other = ref.from === "take" || ref.from === "id" ? await nova.take(ref.id).catch(() => null) : null;
    const reference = other?.video && !("at" in ref && ref.at !== undefined) ? await nova.frame(other.id, (other.meta?.seconds ?? 2) / 2) : await picture(o.match);
    match = { reference, amount: num(o["match-amount"]) ?? 1, colourOnly: !!o["colour-only"] };
  }
  const motion = o.shutter || o.speed ? { shutter: num(o.shutter) ?? 0, speed: num(o.speed) ?? 1 } : undefined;
  const source = { ...(await nova.useTake(job.id, "raw")), label: job.title };
  const spec: GradeSpec = { kind: "grade", source, film, match, motion, from: job.id, seed: num(o.seed) ?? randomSeed() };
  return render([spec], [`Grade: ${look.label}${match ? ", matched" : ""}${motion ? `, shutter ${motion.shutter}°, ${motion.speed}×` : ""}`]);
}

async function run() {
  const recipe = await nova.workflow(arg(1, "Run which workflow? novafield engines lists them."));
  const roles = parsePairs(o.role, "Role") as Record<string, string | number | boolean | (string | number | boolean)[]>;
  for (const [role, file] of Object.entries(parsePairs(o.file, "File"))) {
    const files = (Array.isArray(file) ? file : [file]).map(String);
    roles[role] = await Promise.all(files.map(async (f) => (await nova.upload(f, "raw")).name));
  }
  const { values, unknown } = workflowValues(recipe, roles, parsePairs(o.field, "Field") as Record<string, string | number | boolean>);
  if (unknown.length) throw new NovaError(`${recipe.name} has no ${unknown.join(", ")}.\nIts fields:\n${describeFields(recipe).map((f) => `  ${JSON.stringify(f)}`).join("\n")}`);
  return render([workflowSpec(recipe.id, values)], [`Workflow: ${recipe.name}`]);
}

// Check

async function qc() {
  const id = arg(1, "Check which take? novafield qc <take>");
  note("Checking on the GPU…");
  const r = await nova.qc(id);
  const issues = r.issues.map((i) => {
    const t = issueTime(r, i);
    const until = (i.end + 1) / (r.fps || 24);
    return `  ${t.toFixed(2)}–${until.toFixed(2)} s  ${QC_LABEL[i.kind].label} (${i.severity})${i.amount ? `, ${Math.round(i.amount * 100)}% of the picture` : ""}`;
  });
  out([`QC ${r.score}  ${id}  (${r.frames} frames at ${r.fps} fps)`, ...(issues.length ? issues : ["  No faults found: no frozen frames, jumps, flicker or soft frames."])].join("\n"), r);
}

// Library

async function takes() {
  const list = await nova.takes({
    project: o.project === undefined ? undefined : o.project === UNSORTED ? UNSORTED : ((await project(o.project)) ?? undefined),
    status: o.status as Job["status"],
    kind: o.kind as Job["kind"],
    favorite: o.starred,
    query: o.query,
    limit: num(o.limit) ?? 20,
  });
  out(list.map(line).join("\n") || "No takes.", list);
}

async function asset() {
  const files = o.name ? positionals.slice(1) : positionals.slice(2);
  nova.checkAssetFiles(files);
  const id = o.name ? (await nova.createAsset({ name: o.name, kind: (o.kind as AssetKind) ?? "character", description: o.description })).id : arg(1, 'Which asset? novafield asset <id> <file>… or novafield asset --name "…" <file>…');
  const entry = files.length ? await nova.addAssetFiles(id, files) : (await nova.assets()).find((e) => e.id === id);
  if (!entry) throw new NovaError(`No asset "${id}".`);
  out(`${entry.id}  ${entry.kind.padEnd(9)} ${entry.name}  (${entry.items.length} files)`, entry);
}

async function edit() {
  const key = (await project(o.project)) ?? "all";
  if (positionals[1] === "set") {
    const fresh = positionals.slice(2).map(parseClip);
    if (!fresh.length) throw new NovaError("Which clips? novafield edit set <take>[:in-out][:dissolve]…");
    const before = o.append ? (await nova.sequence(key)).clips : [];
    await nova.setSequence(key, [...before, ...fresh.map((c) => ({ id: "", in: 0, out: 0, ...c }))] as Parameters<NovaField["setSequence"]>[1]);
  }
  const { clips } = await nova.sequence(key);
  const seconds = clips.reduce((t, c, i) => t + Math.max(0, c.out - c.in) - (c.join === "dissolve" && i > 0 ? 0.5 : 0), 0);
  out(
    clips.length ? [...clips.map((c, i) => `${String(i + 1).padStart(2)}. ${c.take}  ${c.in.toFixed(2)}–${c.out.toFixed(2)} s  ${c.join ?? "cut"}${c.muted ? "  muted" : ""}`), `    ${seconds.toFixed(1)} s in all`].join("\n") : `The edit (${key}) is empty.`,
    { key, clips, seconds },
  );
}

async function film() {
  const { clips } = await nova.sequence((await project(o.project)) ?? "all");
  if (!clips.length) throw new NovaError("The edit is empty. novafield edit set <take>… fills it.");
  const track = o.soundtrack ? { url: (await nova.upload(o.soundtrack, "track")).url, start: num(o["music-start"]) ?? 0, mix: (o.mix as "replace" | "under") ?? "replace", volume: num(o.volume) ?? 1 } : undefined;
  note("Assembling with ffmpeg…");
  const made = await nova.assemble(clips, o.title, track);
  if (o.save) note(`Saved ${await save(made.url, o.save, o.title ?? "film")}`);
  out(nova.absolute(made.url) ?? made.url, made);
}

async function findWorkflows() {
  const words = positionals.slice(1).join(" ").toLowerCase().split(/\s+/).filter(Boolean);
  const [lib, saved] = await Promise.all([nova.templates().catch(() => null), nova.savedWorkflows().catch(() => [])]);
  const limit = num(o.limit) ?? 25;
  const templates = (lib?.categories ?? [])
    .flatMap((c) => c.templates.map((t) => ({ ...t, category: c.title })))
    .filter((t) => (!o.media || t.media === o.media) && (!o["local-only"] || !t.api))
    .filter((t) => words.every((w) => [t.title, t.description, t.category, ...t.tags, ...t.models].join(" ").toLowerCase().includes(w)))
    .slice(0, limit);
  const mine = saved.filter((s) => words.every((w) => s.path.toLowerCase().includes(w))).slice(0, limit);
  out(
    [
      ...templates.map((t) => `template:${t.name}\n          ${t.title}  (${t.media}, ${t.api ? "API, paid" : "local GPU"})`),
      ...mine.map((s) => `saved:${s.path}`),
      ...(lib ? [] : ["This ComfyUI has no template library (it comes with ComfyUI 0.3.30 and later)."]),
    ].join("\n") || "Nothing matches.",
    { templates, saved: mine },
  );
}

async function importWorkflow() {
  const what = arg(1, "Import what? novafield import <file.json> | template:<name> | saved:<path>");
  const r = what.startsWith("template:")
    ? await nova.importTemplate(what.slice(9), undefined, o.name)
    : what.startsWith("saved:")
      ? await nova.importSaved(what.slice(6))
      : await nova.importWorkflow(JSON.parse(await readFile(what, "utf8")), o.name ?? path.basename(what));
  out(
    [
      `${r.id}  ${r.name}  (makes ${r.output})`,
      isEngine(r) ? `Usable as a Studio model: novafield shot "…" --engine ${r.id}` : "",
      ...(r.missing.length ? [`Missing node packs: ${r.missing.join(", ")} (install them on the Workflows page or in ComfyUI Manager)`] : []),
      ...(r.paid?.length ? [`Paid API nodes: ${r.paid.join(", ")}`] : []),
      ...describeFields(r).map((f) => `  ${JSON.stringify(f)}`),
    ]
      .filter(Boolean)
      .join("\n"),
    r,
  );
}

/**
 * The MCP server's launch line with absolute paths: Node itself, tsx and this checkout. MCP clients
 * start servers without the shell's PATH and from another folder, so nothing may rely on `pnpm`
 * being found or on the current directory.
 */
function setup() {
  const quote = (s: string) => (/[\s"'$`\\]/.test(s) ? JSON.stringify(s) : s);
  const args = [repoFile("node_modules/tsx/dist/cli.mjs"), "--tsconfig", repoFile("tsconfig.json"), repoFile("src/agent/mcp.ts")];
  const url = process.env.NOVAFIELD_URL;
  const command = `${url ? `NOVAFIELD_URL=${quote(url)} ` : ""}${[process.execPath, ...args].map(quote).join(" ")}`;
  const config = { mcpServers: { novafield: { command: process.execPath, args, ...(url ? { env: { NOVAFIELD_URL: url } } : {}) } } };
  const skills = repoFile("skills");
  out(
    [
      "The NovaField MCP server (stdio) starts with:",
      `  ${command}`,
      "",
      "Most MCP clients take it as this JSON in their MCP server settings; add it, then restart the client:",
      JSON.stringify(config, null, 2).replace(/^/gm, "  "),
      "",
      "Skills (playbooks for short dramas, music videos, product spots, trailers…), one folder each with a SKILL.md:",
      `  ${skills}`,
      "  Link or copy those folders into your agent's skills folder.",
      "",
      `Keep NovaField running (pnpm dev); the tools talk to ${url ?? "http://localhost:4317"}.`,
    ].join("\n"),
    { command, config, skills },
  );
}

async function main() {
  const cmd = positionals[0];
  if (!cmd || o.help) return console.log(HELP);
  switch (cmd) {
    case "status": {
      const s = await nova.status();
      return out(
        [
          `${s.online ? "online" : "OFFLINE"}  ${s.mode === "cloud" ? "Comfy Cloud" : s.url}${s.version ? ` (ComfyUI ${s.version})` : ""}${s.dryRun ? "  [dry run]" : ""}`,
          s.gpu ? `GPU: ${s.gpu.name}, ${(s.gpu.vramFree / 2 ** 30).toFixed(1)} of ${(s.gpu.vramTotal / 2 ** 30).toFixed(1)} GB free` : "",
          s.queue ? `Queue: ${s.queue.running} running, ${s.queue.pending} waiting` : "",
          `API key for paid nodes: ${s.apiKey ? "set" : "not set"}`,
        ]
          .filter(Boolean)
          .join("\n"),
        s,
      );
    }
    case "engines": {
      const list = await nova.workflows();
      return out(
        [
          "h3            local  video  MiniMax H3 (built-in shot engine)",
          ...list.flatMap((r) => [
            `${r.id.padEnd(13)} ${r.paid?.length ? "API  " : "local"}  ${r.output.padEnd(5)}  ${r.name}${r.missing.length ? `  (missing ${r.missing.join(", ")})` : ""}`,
            ...(o.fields ? describeFields(r).map((f) => `                {${Object.entries(f).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")}}`) : []),
          ]),
        ].join("\n"),
        o.fields ? list.map((r) => ({ ...r, fields: describeFields(r) })) : list,
      );
    }
    case "moves":
      return out(cameraVocabulary(), { markdown: cameraVocabulary() });
    case "shot":
      return shot();
    case "recast":
      return recast();
    case "restyle":
      return restyle();
    case "replace":
      return replace();
    case "animate":
      return animate();
    case "image":
      return image();
    case "grade":
      return grade();
    case "run":
      return run();
    case "qc":
      return qc();
    case "takes":
      return takes();
    case "take": {
      const id = arg(1, "Which take? novafield take <id>");
      const j = o.wait || o.save ? await follow(id) : await nova.take(id);
      if (o.save && j.status === "done") note(`Saved ${await save(j.video ?? j.image ?? j.audio, o.save, j.id)}`);
      if (o.wait || o.save) settle([j]);
      return out(line(j), j);
    }
    case "cancel": {
      const j = await nova.cancel(arg(1, "Cancel which take? novafield cancel <id>"));
      return out(line(j), j);
    }
    case "frame": {
      const id = arg(1, "From which take? novafield frame <take> [--at <seconds>]");
      const f = await nova.frame(id, num(o.at));
      if (o.save) note(`Saved ${await save(f.url, o.save, `${id}_${o.at ?? "last"}`)}`);
      return out(`${nova.absolute(f.url)}  (${f.width}×${f.height}, ${f.label})\nUse it as take:${id}${o.at ? `@${o.at}` : ""}`, f);
    }
    case "move": {
      const ids = positionals.slice(1);
      if (!ids.length || o.project === undefined) throw new NovaError("novafield move <take>… --project <id|name|unsorted> [--create]");
      let target = o.project === UNSORTED ? null : ((await nova.findProject(o.project))?.id ?? null);
      if (o.project !== UNSORTED && !target) {
        if (!o.create) throw new NovaError(`No project "${o.project}". Add --create to make it.`);
        target = (await nova.createProject(o.project)).id;
      }
      const { moved } = await nova.move(ids, target);
      return out(`Moved ${moved} take${moved === 1 ? "" : "s"} to ${target ?? "Unsorted"}.`, { moved, project: target });
    }
    case "star": {
      const ids = positionals.slice(1);
      if (!ids.length) throw new NovaError("novafield star <take>… [--off]");
      await Promise.all(ids.map((id) => nova.star(id, !o.off)));
      return out(`${o.off ? "Unstarred" : "Starred"} ${ids.length} take${ids.length === 1 ? "" : "s"}.`, { ids, starred: !o.off });
    }
    case "projects": {
      const list = await nova.projects();
      return out(list.map((p) => `${p.id}  ${p.name}`).join("\n") || "No projects.", list);
    }
    case "assets": {
      const list = (await nova.assets()).filter((e) => !o.kind || e.kind === o.kind);
      return out(list.map((e) => `${e.id}  ${e.kind.padEnd(9)} ${e.name}  (${e.items.length} files)`).join("\n") || "No assets.", list);
    }
    case "asset":
      return asset();
    case "edit":
      return edit();
    case "film":
      return film();
    case "find-workflows":
      return findWorkflows();
    case "import":
      return importWorkflow();
    case "setup":
      return setup();
    default:
      throw new NovaError(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e: unknown) => {
  if (process.stderr.isTTY) process.stderr.write("\r\x1b[2K");
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

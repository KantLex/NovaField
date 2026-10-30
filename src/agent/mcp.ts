// NovaField as an MCP server (stdio): agents plan shots with real camera direction, check their
// price, render them, organise takes, cut the edit and assemble the film, all through the running app.
//
//   pnpm mcp            (NOVAFIELD_URL overrides http://localhost:4317)

import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { UNSORTED } from "@/lib/projects";
import { LOOKS } from "@/lib/cinema/looks";
import { parseRigFile } from "@/lib/cinema/rigFile";
import type { Asset } from "@/lib/engines/specs";
import { isLive, type Job } from "@/lib/jobs";
import { checkBudget, creditsOf } from "@/lib/comfy/budget";
import type { JobSpec } from "@/lib/engines/specs";
import { BudgetError, NovaField, type Preflight } from "./client";
import { MAX_EXTRAS, MAX_PATHS, pathsSpec, recastSpec, replaceSpec, restyleSpec, WAN_FPS } from "./henshin";
import { repoFile } from "./paths";
import { ASPECTS, QUALITIES, buildShot, checkShot, describeFields, workflowSpec, workflowValues, type ShotOptions } from "./shot";
import { cameraVocabulary } from "./vocabulary";
import { isEngine } from "@/lib/workflows/apply";

// Newer stocks (Portra 400, CineStill 800T…) need NovaField nodes 0.3.0 on the server to grade on the GPU.
const LOOK_IDS = LOOKS.map((l) => l.id).join(", ");

const nova = new NovaField();

const server = new McpServer(
  { name: "novafield", version: "0.1.0" },
  {
    instructions: `NovaField is a film studio on ComfyUI: shots with real camera direction (moves, lenses, ghost-rig previs), a cast and asset library, imported ComfyUI workflows, and an editor that cuts takes into a film.
Rules: renders use the shared GPU and may spend paid credits. Always call plan_shot (or run_workflow with plan_only) first, show the person the settings and the price, and get their explicit approval before generate / run_workflow. Both need max_credits; they refuse when the preflight price could exceed it. Never cancel takes you didn't start.
Henshin tools (recast, restyle, replace_object, animate_still) transform existing clips and stills; they follow the same plan_only / max_credits rule.
Read novafield://camera/moves for the move ids and how to stack moves or write a rig.`,
  },
);

// Results

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
const failure = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof BudgetError ? JSON.stringify({ refused: e.message, credits: e.budget.credits }, null, 2) : e instanceof Error ? e.message : String(e) }],
});
function tool<A>(run: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return text(await run(args));
    } catch (e) {
      return failure(e);
    }
  };
}

/** A take as an agent needs it: what, where it stands, and where its files are. */
function takeView(j: Job) {
  return {
    id: j.id,
    title: j.title,
    kind: j.kind,
    status: j.status,
    ...(isLive(j) ? { progress: `${j.progress.stage} ${Math.round(j.progress.pct * 100)}%`, ...(j.ahead ? { ahead: j.ahead } : {}) } : {}),
    project: j.project ?? null,
    favorite: !!j.favorite,
    ...(j.meta?.seconds ? { seconds: j.meta.seconds } : {}),
    ...(j.meta?.width ? { size: `${j.meta.width}×${j.meta.height}` } : {}),
    ...(j.video ? { video: nova.absolute(j.video) } : {}),
    ...(j.image ? { image: nova.absolute(j.image) } : {}),
    ...(j.audio ? { audio: nova.absolute(j.audio) } : {}),
    ...(j.poster ? { poster: nova.absolute(j.poster) } : {}),
    ...(j.error ? { error: j.error } : {}),
    ...(j.dryRun ? { dryRun: true } : {}),
    created: new Date(j.createdAt).toISOString(),
  };
}

/** A preflight in short: can it run, what it makes, and what it costs. */
function planView(p: Preflight, maxCredits?: number) {
  const cr = creditsOf(p);
  const verdict = maxCredits === undefined ? undefined : checkBudget([p], maxCredits);
  return {
    ready: !p.blocker && !p.issues.length,
    ...(p.blocker ? { blocker: p.blocker } : {}),
    ...(p.issues.length ? { issues: p.issues } : {}),
    ...(p.warnings.length ? { warnings: p.warnings.map((w) => `${w.classType}${w.input ? `.${w.input}` : ""}: ${w.message}`) } : {}),
    output: p.meta
      ? {
          kind: p.meta.output ?? "video",
          ...(p.meta.seconds ? { seconds: Math.round(p.meta.seconds * 100) / 100, fps: p.meta.fps } : {}),
          ...(p.meta.width ? { size: `${p.meta.width}×${p.meta.height}` } : {}),
          ...(p.meta.notes?.length ? { notes: p.meta.notes } : {}),
        }
      : null,
    nodes: p.nodes,
    cost: p.paid.length
      ? { paidNodes: p.paid, credits: "unknown" in cr ? `unknown: ${cr.unknown}` : cr.min === cr.max ? cr.max : `${cr.min}–${cr.max}`, approximate: p.price?.approximate ?? true }
      : { paidNodes: [], credits: 0, note: "Runs on the connected ComfyUI GPU only; no API credits." },
    ...(verdict ? { withinBudget: verdict.ok, ...(verdict.reason ? { budget: verdict.reason } : {}) } : {}),
  };
}

async function projectId(p: string | null | undefined): Promise<string | null> {
  if (!p) return null;
  const found = await nova.findProject(p);
  if (!found) throw new Error(`No project "${p}". list_projects shows them; organise_takes can create one.`);
  return found.id;
}

const editKey = async (p: string | null | undefined) => (p ? await projectId(p) : null) ?? "all";

// Inputs

const pictureRef = z
  .object({
    asset: z.string().optional().describe("A library asset id (list_assets)."),
    items: z.array(z.string()).optional().describe("Only these item ids of the asset (default: all its pictures)."),
    file: z.string().optional().describe("Or an absolute path to a local image, uploaded to ComfyUI."),
    take: z.string().optional().describe("Or a frame of a finished video take (its id); an image take is used as it is."),
    at: z.number().min(0).optional().describe("With take: seconds into it (default: its last frame)."),
  })
  .describe("An asset from the library, a local file, or a frame of a take.");

async function pictures(ref: z.infer<typeof pictureRef>): Promise<Asset[]> {
  if (ref.asset) return (await nova.useAsset(ref.asset, "image", ref.items)).filter((a) => a.kind === "image");
  if (ref.file) return [await nova.upload(ref.file, "image")];
  if (ref.take) {
    const t = await nova.take(ref.take);
    return [t.video ? await nova.frame(ref.take, ref.at) : await nova.useTake(ref.take, "image")];
  }
  throw new Error("Each picture needs an asset id, a file path or a take id.");
}

const moveLayer = z.object({ id: z.string(), intensity: z.number().min(0.1).max(2).default(1), when: z.enum(["whole", "start", "end"]).default("whole") });

const shotInput = {
  prompt: z.string().describe("What happens in the shot. Name cast members with @Handle (the asset name without spaces)."),
  move: z.string().optional().describe("Preset camera move id, e.g. push_in, orbit_left, crane_up, dolly_zoom (novafield://camera/moves). Default push_in."),
  combo: z.array(moveLayer).optional().describe("Stacked moves; replaces move."),
  rig: z.record(z.string(), z.unknown()).optional().describe("Hand-written rig {keys, ease, actors, follow, props} in contract coordinates; replaces the preset move."),
  rig_file: z.string().optional().describe("Or an absolute path to a camera-path .json file (a NovaField export, the Blender exporter's output, or the contract format); replaces the preset move."),
  intensity: z.number().min(0.1).max(2).optional().describe("Move strength: 0.3 subtle, 1 normal, 1.6 aggressive."),
  lens: z.number().optional().describe("Focal length in mm: 14, 24, 35, 50, 85 or 135. Default 35."),
  size: z.enum(["extreme_wide", "wide", "full", "medium", "close", "extreme_close"]).optional(),
  angle: z.enum(["eye", "low", "high", "overhead", "dutch"]).optional(),
  lighting: z.string().optional().describe("natural, golden, blue_hour, neon, rembrandt, backlit, overcast, firelight, storm."),
  look: z.string().optional().describe(`Film look: ${LOOK_IDS}.`),
  aspect: z.enum(ASPECTS as [string, ...string[]]).optional(),
  quality: z.enum(QUALITIES as [string, ...string[]]).optional().describe("draft (fast), studio, master. Default draft."),
  duration: z.number().min(1).max(15).optional().describe("Seconds; default 5. H3 may shorten long shots at high quality."),
  seed: z.number().int().optional(),
  camera_mode: z.enum(["rig", "prompt"]).optional().describe("rig (default): render the move as a ghost-rig guide; prompt: describe it only."),
  rig_style: z.enum(["subject", "stage", "starfield", "parallax"]).optional(),
  shake: z.number().min(0).max(1).optional().describe("Extra handheld shake."),
  sound: z.boolean().optional(),
  engine: z.string().optional().describe("Render through an imported workflow (id from list_engines) instead of MiniMax H3."),
  cast: z.array(pictureRef).optional().describe("Characters, objects, places: their reference pictures."),
  start_frame: pictureRef.optional(),
  end_frame: pictureRef.optional(),
  previs: z
    .object({
      file: z.string().optional().describe("Absolute path to a local clip: a Blender or Unreal blockout, a phone walk-through, an animatic."),
      take: z.string().optional().describe("Or the id of a finished video take, to match its camera."),
      follow: z.enum(["camera", "action"]).default("camera").describe("camera: copy only the camera move; action: also the blocking of people and objects."),
    })
    .optional()
    .describe("Your own previs clip (2 to 15 s). MiniMax H3 follows its camera instead of a preset move; the shot length follows the clip unless duration is set."),
  smooth: z.boolean().optional().describe("Interpolate to 48 fps for smoother motion (needs the server's frame-interpolation model; status caps.interpolate)."),
  continue_from: z
    .string()
    .optional()
    .describe("A finished video take this shot carries on from: it starts on that take's last frames, so the two cut together seamlessly (MiniMax H3 only; not with engine or previs). For continuous action across shots."),
};
type ShotArgs = z.infer<z.ZodObject<typeof shotInput>>;

async function shotFrom(a: ShotArgs) {
  const opts: ShotOptions = {
    prompt: a.prompt,
    move: a.move,
    combo: a.combo as ShotOptions["combo"],
    rig: a.rig as unknown as ShotOptions["rig"],
    intensity: a.intensity,
    lens: a.lens,
    size: a.size,
    angle: a.angle,
    lighting: a.lighting,
    look: a.look as ShotOptions["look"],
    aspect: a.aspect as ShotOptions["aspect"],
    quality: a.quality as ShotOptions["quality"],
    duration: a.duration,
    seed: a.seed,
    cameraMode: a.camera_mode,
    rigStyle: a.rig_style,
    shake: a.shake,
    sound: a.sound,
    engine: a.engine,
    continueFrom: a.continue_from,
    smooth: a.smooth,
  };
  if (a.rig_file) {
    const parsed = parseRigFile(await readFile(a.rig_file, "utf8"));
    if ("error" in parsed) throw new Error(parsed.error);
    opts.rig = parsed.rig;
    // The file's length, unless the agent chose one.
    if (a.duration === undefined && parsed.seconds) opts.duration = Math.min(15, Math.max(2, Math.round(parsed.seconds * 2) / 2));
  }
  const bad = checkShot(opts);
  if (bad.length) throw new Error(`Can't plan that shot: ${bad.join("; ")}.`);
  opts.cast = (await Promise.all((a.cast ?? []).map(pictures))).flat().slice(0, 9);
  if (a.start_frame) opts.startFrame = (await pictures(a.start_frame))[0];
  if (a.end_frame) opts.endFrame = (await pictures(a.end_frame))[0];
  if (a.previs) {
    if (!a.previs.file && !a.previs.take) throw new Error("A previs needs a file path or a take id.");
    const clip = a.previs.take ? await nova.useTake(a.previs.take, "h3") : await nova.upload(a.previs.file!, "h3");
    opts.previs = { clip, follow: a.previs.follow };
  }
  return buildShot(opts);
}

const maxCredits = z
  .number()
  .min(0)
  .describe("Required. The most API credits these renders may spend in total, as approved by the person (0 = local GPU only, no paid API nodes). Refused if the preflight price could exceed it.");

// Tools

server.registerTool(
  "status",
  { title: "Studio status", description: "Is NovaField up, which ComfyUI it drives (local GPU or Comfy Cloud), the GPU, the queue on that server, whether an API key for paid nodes is set, and which engines are installed.", inputSchema: {}, annotations: { readOnlyHint: true } },
  tool(async () => nova.status()),
);

server.registerTool(
  "list_engines",
  {
    title: "List engines",
    description: "What can render: the built-in MiniMax H3 shot engine and every imported ComfyUI workflow, each tagged local (GPU) or API (paid cloud nodes), with its output kind, missing nodes, and the form fields with their roles (for run_workflow).",
    inputSchema: { fields: z.boolean().default(false).describe("Include each workflow's form fields.") },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ fields }: { fields: boolean }) => {
    const [status, recipes] = await Promise.all([nova.status(), nova.workflows()]);
    return [
      { id: "h3", name: "MiniMax H3 (built-in shot engine)", kind: "shot", runs: "local", paid: false, output: "video", available: !!status.caps.h3, note: "Use plan_shot / generate. Camera moves, lens, ghost rig, cast references, film lab." },
      ...recipes.map((r) => ({
        id: r.id,
        name: r.name,
        kind: "workflow",
        runs: r.paid?.length ? "api" : "local",
        paid: !!r.paid?.length,
        ...(r.paid?.length ? { paidNodes: r.paid } : {}),
        output: r.output,
        available: !r.missing.length,
        ...(r.missing.length ? { missing: r.missing } : {}),
        roles: [...new Set(r.fields.filter((f) => f.role !== "none").map((f) => f.role))],
        ...(fields ? { fields: describeFields(r) } : {}),
      })),
    ];
  }),
);

server.registerTool(
  "plan_shot",
  {
    title: "Plan a shot (free)",
    description: "Compile a shot exactly as generate would and preflight it on the server, without rendering: blocking problems, warnings, what it will make (length, size) and its API credit price. Free. Show the result to the person before generate.",
    inputSchema: { ...shotInput, max_credits: maxCredits.optional().describe("Optional: say whether this would fit that ceiling.") },
    annotations: { readOnlyHint: true },
  },
  tool(async (a: ShotArgs & { max_credits?: number }) => {
    const spec = await shotFrom(a);
    return { ...planView(await nova.preflight(spec), a.max_credits), seed: spec.seed };
  }),
);

server.registerTool(
  "generate",
  {
    title: "Render a shot",
    description:
      "Render a shot (same inputs as plan_shot) on the connected ComfyUI. Only after the person approved the plan and its price. max_credits is required: the server preflights every take and refuses when the total could exceed it. Returns the new takes; follow them with get_take (wait_seconds).",
    inputSchema: {
      ...shotInput,
      max_credits: maxCredits,
      takes: z.number().int().min(1).max(4).default(1).describe("Variations, each with its own seed."),
      project: z.string().optional().describe("Project id or name for the new takes."),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  tool(async (a: ShotArgs & { max_credits: number; takes: number; project?: string }) => {
    const first = await shotFrom(a);
    const specs = Array.from({ length: a.takes }, (_, i) => (i === 0 ? first : { ...first, seed: Math.floor(Math.random() * 2 ** 47) }));
    const { jobs, budget } = await nova.generate(specs, { maxCredits: a.max_credits, project: await projectId(a.project) });
    return { queued: jobs.map(takeView), credits: budget.credits };
  }),
);

server.registerTool(
  "run_workflow",
  {
    title: "Run an imported workflow",
    description:
      "Run one of the imported ComfyUI workflows (list_engines) by field role: e.g. {prompt: '…', seed: 7, image: 'input.png'} fills the first field with that role (a list fills several). Image/video/audio roles take a file name already in ComfyUI's input folder; use `files` to upload local files for a role. With plan_only it only preflights (free). Otherwise max_credits is required and the run is refused when the price could exceed it.",
    inputSchema: {
      workflow: z.string().describe("Workflow id (list_engines)."),
      roles: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))])).optional().describe("Values by role: prompt, negative, image, video, audio, seed, width, height, aspect, frames, seconds, steps."),
      fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional().describe("Values by field id (node.input); these win over roles."),
      files: z.record(z.string(), z.array(z.string())).optional().describe("Local files to upload for a role, e.g. {image: ['/path/a.png']}."),
      plan_only: z.boolean().default(false).describe("Only preflight: problems and price. Free."),
      max_credits: maxCredits.optional(),
      project: z.string().optional(),
    },
    annotations: { openWorldHint: true },
  },
  tool(async (a: { workflow: string; roles?: Record<string, unknown>; fields?: Record<string, string | number | boolean>; files?: Record<string, string[]>; plan_only: boolean; max_credits?: number; project?: string }) => {
    const recipe = await nova.workflow(a.workflow);
    const roles = { ...(a.roles ?? {}) } as Record<string, string | number | boolean | (string | number | boolean)[]>;
    for (const [role, paths] of Object.entries(a.files ?? {})) roles[role] = await Promise.all(paths.map(async (p) => (await nova.upload(p, "raw")).name));
    const { values, unknown } = workflowValues(recipe, roles, a.fields);
    if (unknown.length) throw new Error(`${recipe.name} has no ${unknown.join(", ")}. Its fields: ${JSON.stringify(describeFields(recipe))}`);
    const spec = workflowSpec(recipe.id, values);
    if (a.plan_only) return planView(await nova.preflight(spec), a.max_credits);
    if (a.max_credits === undefined) throw new Error("max_credits is required to run a workflow (0 if it should only use the local GPU). Plan it first with plan_only.");
    const { jobs, budget } = await nova.generate([spec], { maxCredits: a.max_credits, project: await projectId(a.project) });
    return { queued: jobs.map(takeView), credits: budget.credits };
  }),
);

server.registerTool(
  "get_take",
  {
    title: "Get or wait for a take",
    description: "A take's status, progress and file URLs. With wait_seconds it waits (up to that long) for the take to finish first.",
    inputSchema: { id: z.string(), wait_seconds: z.number().min(0).max(600).default(0) },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ id, wait_seconds }: { id: string; wait_seconds: number }) => takeView(wait_seconds > 0 ? await nova.wait(id, { timeoutMs: wait_seconds * 1000 }) : await nova.take(id))),
);

server.registerTool(
  "list_takes",
  {
    title: "List takes",
    description: "Takes in the library, newest first, with filters.",
    inputSchema: {
      project: z.string().optional().describe(`Project id or name, or "${UNSORTED}" for takes in no project.`),
      status: z.enum(["live", "preparing", "queued", "running", "done", "failed", "cancelled"]).optional(),
      kind: z.enum(["shot", "recast", "restyle", "replace", "paths", "workflow", "image", "grade"]).optional(),
      starred: z.boolean().optional(),
      query: z.string().optional().describe("Words in the title."),
      limit: z.number().int().min(1).max(200).default(30),
    },
    annotations: { readOnlyHint: true },
  },
  tool(async (a: { project?: string; status?: Job["status"] | "live"; kind?: Job["kind"]; starred?: boolean; query?: string; limit: number }) => {
    const project = a.project === undefined ? undefined : a.project === UNSORTED ? UNSORTED : ((await projectId(a.project)) ?? undefined);
    return (await nova.takes({ project, status: a.status, kind: a.kind, favorite: a.starred, query: a.query, limit: a.limit })).map(takeView);
  }),
);

server.registerTool(
  "cancel_take",
  {
    title: "Cancel a take",
    description: "Cancel a take this agent started that is still rendering. Only that take's own prompt is removed; other people's work on the shared server is never touched.",
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true },
  },
  tool(async ({ id }: { id: string }) => takeView(await nova.cancel(id))),
);

server.registerTool(
  "list_assets",
  {
    title: "List assets",
    description: "The asset library: characters, objects, locations, styles and clips, with their pictures (item ids) and descriptions. Use an asset id in cast / start_frame.",
    inputSchema: { kind: z.enum(["character", "object", "location", "style", "clip"]).optional() },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ kind }: { kind?: string }) =>
    (await nova.assets())
      .filter((e) => !kind || e.kind === kind)
      .map((e) => ({
        id: e.id,
        name: e.name,
        handle: `@${e.name.replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 16)}`,
        kind: e.kind,
        description: e.description,
        items: e.items.map((i) => ({ id: i.id, kind: i.kind, label: i.label ?? null, url: nova.absolute(i.url) })),
      })),
  ),
);

server.registerTool(
  "register_asset",
  {
    title: "Register an asset",
    description: "Add a character, object, location, style or clip to the library with its pictures, so later shots can cast it. Files are local paths (uploaded) or a take's file URL (copied). To add pictures to an existing asset, pass its id.",
    inputSchema: {
      id: z.string().optional().describe("An existing asset to add files to."),
      name: z.string().optional(),
      kind: z.enum(["character", "object", "location", "style", "clip"]).optional(),
      description: z.string().optional().describe("What the pictures don't say: age, wardrobe, material, mood."),
      files: z.array(z.string()).default([]),
    },
  },
  tool(async (a: { id?: string; name?: string; kind?: "character" | "object" | "location" | "style" | "clip"; description?: string; files: string[] }) => {
    nova.checkAssetFiles(a.files);
    const id = a.id ?? (await nova.createAsset({ name: a.name ?? "", kind: a.kind ?? "character", description: a.description })).id;
    const entry = a.files.length ? await nova.addAssetFiles(id, a.files) : (await nova.assets()).find((e) => e.id === id);
    return entry ? { id: entry.id, name: entry.name, kind: entry.kind, items: entry.items.map((i) => ({ id: i.id, kind: i.kind, url: nova.absolute(i.url) })) } : { id };
  }),
);

server.registerTool(
  "list_projects",
  { title: "List projects", description: "Projects (folders of takes, each with its own edit).", inputSchema: {}, annotations: { readOnlyHint: true } },
  tool(async () => nova.projects()),
);

server.registerTool(
  "organise_takes",
  {
    title: "Organise takes",
    description: "Move takes into a project (or back to Unsorted with project: null), star or unstar them, and create the project first if asked.",
    inputSchema: {
      ids: z.array(z.string()).min(1),
      project: z.string().nullable().optional().describe("Project id or name to move them to; null for Unsorted; left out to not move."),
      create_project: z.boolean().default(false).describe("Create the project by that name if it doesn't exist."),
      starred: z.boolean().optional(),
    },
  },
  tool(async (a: { ids: string[]; project?: string | null; create_project: boolean; starred?: boolean }) => {
    const done: Record<string, unknown> = {};
    if (a.project !== undefined) {
      let target = a.project === null ? null : ((await nova.findProject(a.project))?.id ?? null);
      if (a.project !== null && !target) {
        if (!a.create_project) throw new Error(`No project "${a.project}". Pass create_project: true to make it.`);
        target = (await nova.createProject(a.project)).id;
        done.created = target;
      }
      done.moved = (await nova.move(a.ids, target)).moved;
      done.project = target;
    }
    if (a.starred !== undefined) done.starred = (await Promise.all(a.ids.map((id) => nova.star(id, a.starred!)))).length;
    return done;
  }),
);

const clipInput = z.object({
  take: z.string(),
  in: z.number().min(0).optional().describe("Seconds into the take where the clip starts (default: start, minus any repeated head frames)."),
  out: z.number().min(0).optional().describe("Where it ends (default: end of the take)."),
  join: z.enum(["cut", "dissolve"]).optional().describe("How it comes in from the clip before."),
  muted: z.boolean().optional(),
});

server.registerTool(
  "get_edit",
  {
    title: "Get the edit",
    description: "A project's edit (the Sequence editor's timeline): clips in cut order with in/out points and joins, plus the running length. The same edit the person sees in the editor.",
    inputSchema: { project: z.string().optional().describe('Project id or name; left out is the edit shown when no project is chosen ("all").') },
    annotations: { readOnlyHint: true },
  },
  tool(async ({ project }: { project?: string }) => {
    const key = await editKey(project);
    const { clips } = await nova.sequence(key);
    const length = clips.reduce((t, c, i) => t + Math.max(0, c.out - c.in) - (c.join === "dissolve" && i > 0 ? 0.5 : 0), 0);
    return { key, clips, seconds: Math.round(length * 100) / 100 };
  }),
);

server.registerTool(
  "set_edit",
  {
    title: "Set the edit",
    description: "Replace (or append to) a project's edit. Each clip is a finished take with optional in/out seconds and a cut or dissolve. The editor open in the browser updates live.",
    inputSchema: {
      project: z.string().optional(),
      clips: z.array(z.union([z.string(), clipInput])).describe("Take ids (whole takes) or clips."),
      append: z.boolean().default(false).describe("Add after the current edit instead of replacing it."),
    },
  },
  tool(async (a: { project?: string; clips: (string | z.infer<typeof clipInput>)[]; append: boolean }) => {
    const key = await editKey(a.project);
    const fresh = a.clips.map((c) => (typeof c === "string" ? c : { id: "", in: 0, out: 0, ...c }));
    const before = a.append ? (await nova.sequence(key)).clips : [];
    const { clips } = await nova.setSequence(key, [...before, ...fresh] as Parameters<NovaField["setSequence"]>[1]);
    return { key, clips };
  }),
);

server.registerTool(
  "assemble_film",
  {
    title: "Assemble the film",
    description: "Cut a project's edit (or the clips given) into one MP4 with ffmpeg on this machine: trims, cuts and dissolves. No GPU and no credits. Returns the film's URL.",
    inputSchema: {
      project: z.string().optional().describe("Use this project's saved edit."),
      clips: z.array(z.union([z.string(), clipInput])).optional().describe("Or these clips instead of the saved edit."),
      title: z.string().optional(),
      soundtrack: z
        .object({
          file: z.string().describe("Absolute path to a local audio file (or a video with sound): the song or score."),
          start: z.number().min(0).default(0).describe("Seconds into the file where the film's first frame lands."),
          mix: z.enum(["replace", "under"]).default("replace").describe("replace: the music is the only sound (music videos); under: the takes' own sound stays, lowered, beneath it."),
          volume: z.number().min(0).max(1).default(1),
        })
        .optional()
        .describe("Music over the whole film, cut to its length with a one-second fade at the end."),
    },
  },
  tool(async (a: { project?: string; clips?: (string | z.infer<typeof clipInput>)[]; title?: string; soundtrack?: { file: string; start: number; mix: "replace" | "under"; volume: number } }) => {
    const clips = a.clips?.length
      ? a.clips.map((c, i) => (typeof c === "string" ? { id: `c${i}`, take: c, in: 0, out: 0 } : { id: `c${i}`, in: 0, out: 0, ...c }))
      : (await nova.sequence(await editKey(a.project))).clips;
    if (!clips.length) throw new Error("That edit is empty. Add clips with set_edit first.");
    const track = a.soundtrack ? { url: (await nova.upload(a.soundtrack.file, "track")).url, start: a.soundtrack.start, mix: a.soundtrack.mix, volume: a.soundtrack.volume } : undefined;
    const film = await nova.assemble(clips, a.title, track);
    return { ...film, url: nova.absolute(film.url) };
  }),
);

server.registerTool(
  "take_frame",
  {
    title: "Grab a frame from a take",
    description:
      "Save one frame of a finished video take as a picture: its last frame by default, or `at` seconds in. Returns its URL. Use it for keyframes (start_frame / end_frame of the next shot), thumbnails, a still to animate, or a cast picture (register_asset files: [url]). Shot inputs also take {take, at} directly as a picture. Free; no GPU.",
    inputSchema: { take: z.string(), at: z.number().min(0).optional().describe("Seconds into the take; left out = the last frame.") },
  },
  tool(async ({ take, at }: { take: string; at?: number }) => {
    const f = await nova.frame(take, at);
    return { url: nova.absolute(f.url), width: f.width, height: f.height, label: f.label, use: { take, ...(at === undefined ? {} : { at }) } };
  }),
);

server.registerTool(
  "find_workflows",
  {
    title: "Find ComfyUI workflows to import",
    description:
      "What can be imported as a NovaField workflow: ComfyUI's template library (by category, with what each makes, its models, and whether it runs on paid API nodes) and the workflows saved in ComfyUI itself. Filter with `query` (words in the title, description, tags or models) and `media` (image, video, audio, 3d). Then import_workflow.",
    inputSchema: {
      query: z.string().optional(),
      media: z.enum(["image", "video", "audio", "3d"]).optional(),
      local_only: z.boolean().default(false).describe("Only templates that run on the GPU (no paid API nodes)."),
      limit: z.number().int().min(1).max(100).default(25),
    },
    annotations: { readOnlyHint: true },
  },
  tool(async (a: { query?: string; media?: string; local_only: boolean; limit: number }) => {
    const words = (a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const [lib, saved] = await Promise.all([nova.templates().catch(() => null), nova.savedWorkflows().catch(() => [])]);
    const templates = (lib?.categories ?? [])
      .flatMap((c) => c.templates.map((t) => ({ ...t, category: c.title })))
      .filter((t) => (!a.media || t.media === a.media) && (!a.local_only || !t.api))
      .filter((t) => words.every((w) => [t.title, t.description, t.category, ...t.tags, ...t.models].join(" ").toLowerCase().includes(w)))
      .slice(0, a.limit)
      .map((t) => ({ template: t.name, title: t.title, category: t.category, makes: t.media, models: t.models, runs: t.api ? "api (paid)" : "local GPU", description: t.description }));
    const mine = saved.filter((s) => words.every((w) => s.path.toLowerCase().includes(w))).slice(0, a.limit).map((s) => ({ saved: s.path }));
    return { templates, savedInComfyUI: mine, ...(lib ? {} : { note: "This ComfyUI has no template library (it comes with ComfyUI 0.3.30 and later)." }) };
  }),
);

server.registerTool(
  "import_workflow",
  {
    title: "Import a ComfyUI workflow",
    description:
      "Turn a ComfyUI workflow into a NovaField workflow with a form: a local .json file (canvas or API format), a template from find_workflows, or a workflow saved in ComfyUI. Reports what it makes, its form fields by role, missing node packs and paid API nodes. Image or video workflows with a prompt also become Studio models (engine). Free; nothing renders.",
    inputSchema: {
      file: z.string().optional().describe("Absolute path to a workflow .json."),
      template: z.string().optional().describe("A template name from find_workflows."),
      saved: z.string().optional().describe("A path from find_workflows savedInComfyUI."),
      name: z.string().optional().describe("What to call it in NovaField."),
    },
  },
  tool(async (a: { file?: string; template?: string; saved?: string; name?: string }) => {
    const r = a.file
      ? await nova.importWorkflow(JSON.parse(await readFile(a.file, "utf8")), a.name ?? a.file.split("/").pop()!)
      : a.template
        ? await nova.importTemplate(a.template, undefined, a.name)
        : a.saved
          ? await nova.importSaved(a.saved)
          : null;
    if (!r) throw new Error("Give a file, a template or a saved workflow.");
    return {
      id: r.id,
      name: r.name,
      makes: r.output,
      engine: isEngine(r) ? "Usable as a Studio model: pass this id as engine in plan_shot / generate." : undefined,
      fields: describeFields(r),
      ...(r.missing.length ? { missing: r.missing, note: "Missing node packs: install them in the app (Workflows page) or ComfyUI Manager, then try again." } : {}),
      ...(r.paid?.length ? { paidNodes: r.paid } : {}),
      ...(r.warnings?.length ? { warnings: r.warnings } : {}),
    };
  }),
);

// Henshin: transform clips and stills

const clipRef = z
  .object({
    take: z.string().optional().describe("A finished video take's id."),
    asset: z.string().optional().describe("Or a clip asset from the library (list_assets kind clip)."),
    file: z.string().optional().describe("Or an absolute path to a local video."),
  })
  .describe("The clip to transform: a take, a library clip, or a local file.");

/** A clip conformed for its model: "h3" (24 fps, up to 15 s) or "wan" (16 fps, 5 s). */
async function clipFor(ref: z.infer<typeof clipRef>, purpose: "h3" | "wan"): Promise<Asset> {
  if (ref.take) return nova.useTake(ref.take, purpose);
  if (ref.asset) {
    const clip = (await nova.useAsset(ref.asset, purpose)).find((x) => x.kind === "video");
    if (!clip) throw new Error("That asset has no video clip.");
    return clip;
  }
  if (ref.file) return nova.upload(ref.file, purpose);
  throw new Error("Give the clip as a take id, a clip asset id or a file path.");
}

const henshinRun = {
  plan_only: z.boolean().default(false).describe("Only preflight: problems, what it makes and the price. Free."),
  max_credits: maxCredits.optional().describe("Required unless plan_only. The most API credits it may spend (0 = local GPU only)."),
  project: z.string().optional().describe("Project id or name for the new take."),
};
type HenshinRun = { plan_only: boolean; max_credits?: number; project?: string };

async function runHenshin(spec: JobSpec, a: HenshinRun) {
  if (a.plan_only) return { ...planView(await nova.preflight(spec), a.max_credits), seed: (spec as { seed: number }).seed };
  if (a.max_credits === undefined) throw new Error("max_credits is required (0 if it should only use the local GPU). Plan it first with plan_only.");
  const { jobs, budget } = await nova.generate([spec], { maxCredits: a.max_credits, project: await projectId(a.project) });
  return { queued: jobs.map(takeView), credits: budget.credits };
}

const sound = z.enum(["original", "generated", "none"]).default("original").describe("original: keep the clip's sound; generated: new sound for the new picture; none: silent.");
const quality = z.enum(QUALITIES as [string, ...string[]]).default("draft").describe("draft (fast), studio, master.");

server.registerTool(
  "recast",
  {
    title: "Recast a clip (Henshin)",
    description:
      "Swap the person in a clip for a character, keeping the motion, timing, framing and camera (MiniMax H3 reference-to-video). The source is 2 to 15 s. notes can also change wardrobe, lighting or background. Use it to keep one face across a whole film: shoot with any stand-in, then recast every shot to the lead.",
    inputSchema: {
      source: clipRef,
      character: pictureRef.describe("The new lead: a clear, front-facing, full-body picture works best."),
      extras: z.array(pictureRef).max(MAX_EXTRAS).optional().describe(`Up to ${MAX_EXTRAS} more pictures: other people or props in the clip.`),
      notes: z.string().optional().describe("Direction, e.g. 'keep the red umbrella, make it night'."),
      audio: sound,
      quality,
      seed: z.number().int().optional(),
      ...henshinRun,
    },
    annotations: { openWorldHint: true },
  },
  tool(async (a: { source: z.infer<typeof clipRef>; character: z.infer<typeof pictureRef>; extras?: z.infer<typeof pictureRef>[]; notes?: string; audio: "original" | "generated" | "none"; quality: string; seed?: number } & HenshinRun) => {
    const [source, character, extras] = await Promise.all([clipFor(a.source, "h3"), pictures(a.character).then((p) => p[0]), Promise.all((a.extras ?? []).map((e) => pictures(e).then((p) => p[0])))]);
    if (!character) throw new Error("The character needs a picture.");
    return runHenshin(recastSpec({ source, character, extras: extras.filter(Boolean), notes: a.notes, audio: a.audio, quality: a.quality as never, seed: a.seed }), a);
  }),
);

server.registerTool(
  "restyle",
  {
    title: "Restyle a clip (Henshin)",
    description:
      "Re-render a clip in a new look, shot for shot: same motion and framing, new medium (claymation, anime cel, oil paint, a period film stock…). Give the style in words, a style picture, or both; a film look grades it on the GPU afterwards. The source is 2 to 15 s.",
    inputSchema: {
      source: clipRef,
      style: z.string().optional().describe("The new look in words, e.g. 'stop-motion claymation with felt textures'."),
      style_picture: pictureRef.optional().describe("A picture in the target style."),
      look: z.string().default("none").describe(`Film look graded on top: ${LOOK_IDS}.`),
      audio: sound,
      quality,
      seed: z.number().int().optional(),
      ...henshinRun,
    },
    annotations: { openWorldHint: true },
  },
  tool(async (a: { source: z.infer<typeof clipRef>; style?: string; style_picture?: z.infer<typeof pictureRef>; look: string; audio: "original" | "generated" | "none"; quality: string; seed?: number } & HenshinRun) => {
    const [source, styleRef] = await Promise.all([clipFor(a.source, "h3"), a.style_picture ? pictures(a.style_picture).then((p) => p[0]) : undefined]);
    return runHenshin(restyleSpec({ source, style: a.style, styleRef, look: a.look, audio: a.audio, quality: a.quality as never, seed: a.seed }), a);
  }),
);

const boxInput = z.object({
  x: z.number().min(0).max(1).describe("Left edge, as a fraction of the frame width."),
  y: z.number().min(0).max(1).describe("Top edge, as a fraction of the frame height."),
  w: z.number().min(0.02).max(1),
  h: z.number().min(0.02).max(1),
  at: z.number().min(0).optional().describe("Seconds into the clip this box is right for (default 0). Between boxes it eases."),
});

server.registerTool(
  "replace_object",
  {
    title: "Replace an object in a clip (Henshin)",
    description: `Track a box over the thing to replace and swap it for something else; everything outside the box is kept (Wan 2.1 VACE at ${WAN_FPS} fps, the first 5 s of the clip). Give one box for something still, or boxes at several times for something that moves: the box eases between them. Look at the clip's frames (get_take poster, or the file) to place the boxes.`,
    inputSchema: {
      source: clipRef,
      boxes: z.array(boxInput).min(1).describe("Where the thing is, in 0–1 frame coordinates, at one or more times."),
      shape: z.enum(["rect", "ellipse"]).default("rect"),
      becomes: z.string().optional().describe("What it turns into, e.g. 'a golden retriever sitting calmly'."),
      picture: pictureRef.optional().describe("A picture of what it turns into."),
      seed: z.number().int().optional(),
      ...henshinRun,
    },
    annotations: { openWorldHint: true },
  },
  tool(async (a: { source: z.infer<typeof clipRef>; boxes: z.infer<typeof boxInput>[]; shape: "rect" | "ellipse"; becomes?: string; picture?: z.infer<typeof pictureRef>; seed?: number } & HenshinRun) => {
    const [source, replacement] = await Promise.all([clipFor(a.source, "wan"), a.picture ? pictures(a.picture).then((p) => p[0]) : undefined]);
    return runHenshin(replaceSpec({ source, boxes: a.boxes, shape: a.shape, prompt: a.becomes, replacement, seed: a.seed }), a);
  }),
);

const pathInput = z.object({
  points: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(1).describe("[x, y] in 0–1 picture coordinates; the first point is where the thing starts. One point pins it still."),
  start: z.number().min(0).max(1).optional().describe("When it starts moving, as a fraction of the clip (default 0)."),
  end: z.number().min(0).max(1).optional().describe("When it arrives (default 1)."),
  ease: z.enum(["smooth", "linear", "in", "out"]).optional(),
});

server.registerTool(
  "animate_still",
  {
    title: "Animate a still along paths (Henshin)",
    description: `Bring a still to life by drawing where things move (WanMove with Wan 2.1 image-to-video, 5 s). Each path moves the thing under its first point along it; single points pin things still. A frame move (pan, tilt, push, pull) moves the whole picture like a camera. Up to ${MAX_PATHS} paths in all. The clip takes the still's shape.`,
    inputSchema: {
      image: pictureRef.describe("The still to animate."),
      paths: z.array(pathInput).default([]),
      frame_move: z
        .object({ move: z.enum(["pan_left", "pan_right", "tilt_up", "tilt_down", "push_in", "pull_out"]), amount: z.number().min(0.05).max(0.4).default(0.15) })
        .optional(),
      prompt: z.string().optional().describe("What happens, e.g. 'the paper boat drifts down the stream as leaves fall'."),
      seed: z.number().int().optional(),
      ...henshinRun,
    },
    annotations: { openWorldHint: true },
  },
  tool(async (a: { image: z.infer<typeof pictureRef>; paths: z.infer<typeof pathInput>[]; frame_move?: { move: "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "push_in" | "pull_out"; amount: number }; prompt?: string; seed?: number } & HenshinRun) => {
    const image = (await pictures(a.image))[0];
    if (!image) throw new Error("The still needs a picture.");
    return runHenshin(pathsSpec({ image, paths: a.paths as never, frame: a.frame_move, prompt: a.prompt, seed: a.seed }), a);
  }),
);

// Resources

server.registerResource(
  "camera-moves",
  "novafield://camera/moves",
  { title: "Camera vocabulary", description: "Every camera move id with what it does, shot sizes, angles, lenses, lighting and film looks, and how to stack moves or write a rig.", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: cameraVocabulary() }] }),
);

server.registerResource(
  "camera-contract",
  "novafield://camera/contract",
  { title: "Camera-path contract", description: "The camera_path JSON (keys, ease, shake, stand-ins, follow, set pieces), its exact maths, and the ghost-rig scene. Read before writing a rig by hand.", mimeType: "text/markdown" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: await readFile(repoFile("docs/contract.md"), "utf8") }] }),
);

server.registerResource(
  "job-specs",
  "novafield://specs",
  { title: "Job specs", description: "The TypeScript types for every job the app runs (ShotSpec, WorkflowSpec, RecastSpec…).", mimeType: "text/x-typescript" },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/x-typescript", text: await readFile(repoFile("src/lib/engines/specs.ts"), "utf8") }] }),
);

server
  .connect(new StdioServerTransport())
  .then(() => console.error(`NovaField MCP server on stdio, talking to ${nova.base}`))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });

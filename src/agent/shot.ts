// Turning an agent's short description of a shot, or of a workflow run, into the app's specs.

import type { CustomRig } from "@/lib/cinema/custom";
import { LOOKS, LIGHTING } from "@/lib/cinema/looks";
import { ANGLES, LENSES, MOVES, SHOT_SIZES, type Angle, type Lens, type MoveLayer, type ShotSize } from "@/lib/cinema/moves";
import type { InputValue } from "@/lib/comfy/graph";
import { previsSeconds } from "@/lib/engines/sizing";
import type { Aspect, Asset, FilmLab, Quality, ShotSpec, WorkflowSpec } from "@/lib/engines/specs";
import type { Field, RecipeSummary, Role } from "@/lib/workflows/types";

/** Mirrors DEFAULT_FILM in src/ui/state.ts (the Studio's starting film lab). */
export const DEFAULT_FILM: FilmLab = { look: "kodak_2383", intensity: 0.75, grain: 0.35, halation: 0.3, vignette: 0.25, chromatic: 0.1, gateWeave: 0.15, streak: 0 };

export const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "2.39:1", "4:3"];
export const QUALITIES: Quality[] = ["draft", "studio", "master"];

export interface ShotOptions {
  prompt: string;
  move?: string;
  /** Stacked moves; replaces `move`. */
  combo?: MoveLayer[];
  /** A hand-written camera rig (marks, stand-ins, follow, set pieces); replaces the preset move. */
  rig?: CustomRig;
  intensity?: number;
  lens?: number;
  size?: ShotSize;
  angle?: Angle;
  lighting?: string;
  look?: FilmLab["look"];
  aspect?: Aspect;
  quality?: Quality;
  duration?: number;
  seed?: number;
  /** "rig" renders the move as a ghost-rig guide on the GPU; "prompt" only describes it. */
  cameraMode?: "rig" | "prompt";
  rigStyle?: ShotSpec["rigStyle"];
  shake?: number;
  sound?: boolean;
  /** An imported workflow to render through instead of MiniMax H3 (its id). */
  engine?: string | null;
  cast?: Asset[];
  startFrame?: Asset;
  endFrame?: Asset;
  /** The user's own previs clip (conformed for H3): its camera, and with "action" its blocking, drive the shot. */
  previs?: { clip: Asset; follow: "camera" | "action" };
  /** A finished take this shot carries on from: it starts where that one ends (MiniMax H3 only). */
  continueFrom?: string;
  /** Interpolate to 48 fps for smoother motion (needs the server's frame-interpolation model). */
  smooth?: boolean;
}

/** Frames of the earlier take the continuation repeats, so the cut between them is seamless (as the Studio). */
export const CONTINUE_OVERLAP = 22;

export const randomSeed = () => Math.floor(Math.random() * 2 ** 47);

/** Check the words an agent may get wrong before the app has to. */
export function checkShot(o: ShotOptions): string[] {
  const bad: string[] = [];
  const moveIds = new Set(MOVES.map((m) => m.id));
  if (!o.prompt?.trim()) bad.push("prompt is empty");
  if (o.move && !moveIds.has(o.move)) bad.push(`unknown move "${o.move}" (see novafield://camera/moves)`);
  for (const l of o.combo ?? []) if (!moveIds.has(l.id)) bad.push(`unknown move "${l.id}" in combo`);
  if (o.lens !== undefined && !LENSES.includes(o.lens as Lens)) bad.push(`lens must be one of ${LENSES.join(", ")} mm`);
  if (o.size && !SHOT_SIZES.some((s) => s.id === o.size)) bad.push(`unknown size "${o.size}"`);
  if (o.angle && !ANGLES.some((a) => a.id === o.angle)) bad.push(`unknown angle "${o.angle}"`);
  if (o.lighting && !LIGHTING.some((l) => l.id === o.lighting)) bad.push(`unknown lighting "${o.lighting}"`);
  if (o.look && !LOOKS.some((l) => l.id === o.look)) bad.push(`unknown film look "${o.look}"`);
  if (o.aspect && !ASPECTS.includes(o.aspect)) bad.push(`aspect must be one of ${ASPECTS.join(", ")}`);
  if (o.quality && !QUALITIES.includes(o.quality)) bad.push(`quality must be one of ${QUALITIES.join(", ")}`);
  if (o.continueFrom && o.engine) bad.push("continue_from works with MiniMax H3 only, not an imported engine");
  if (o.continueFrom && o.previs) bad.push("continue_from and previs can't be combined: the shot either carries on from a take or follows a previs");
  return bad;
}

/** A full ShotSpec with the Studio's defaults for whatever the agent left out. */
export function buildShot(o: ShotOptions): ShotSpec {
  return {
    kind: "shot",
    prompt: o.prompt.trim(),
    cast: o.cast ?? [],
    ...(o.startFrame ? { startFrame: o.startFrame } : {}),
    ...(o.endFrame ? { endFrame: o.endFrame } : {}),
    size: o.size ?? "medium",
    angle: o.angle ?? "eye",
    lens: (o.lens ?? 35) as Lens,
    move: o.move ?? "push_in",
    intensity: o.intensity ?? 1,
    combo: o.combo?.length ? o.combo : null,
    rig: o.rig ?? null,
    timing: "auto",
    shake: o.shake ?? 0,
    cameraMode: o.cameraMode ?? "rig",
    rigStyle: o.rigStyle ?? "subject",
    lighting: o.lighting ?? "natural",
    film: { ...DEFAULT_FILM, ...(o.look ? { look: o.look } : {}) },
    filmOnGpu: true,
    aspect: o.aspect ?? "16:9",
    quality: o.quality ?? "draft",
    // A previs sets the length unless the agent chose one.
    duration: o.duration ?? (o.previs ? previsSeconds(o.previs.clip) : 5),
    ...(o.previs ? { previs: o.previs } : {}),
    seed: o.seed ?? randomSeed(),
    turbo: true,
    smooth: o.smooth ?? false,
    sound: o.sound ?? true,
    engine: o.engine ?? null,
    ...(o.continueFrom ? { extend: { fromJob: o.continueFrom, overlapFrames: CONTINUE_OVERLAP } } : {}),
  };
}

/** The form fields that carry a role, as an agent should see them. */
export function describeFields(r: RecipeSummary) {
  return r.fields
    .filter((f) => f.exposed || f.role !== "none")
    .map((f) => ({ id: f.id, role: f.role, kind: f.kind, label: f.label, value: f.value, ...(f.options ? { options: f.options } : {}), ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) }));
}

/**
 * Values for a workflow run: by role ("prompt", "seed", "image"…) and/or by field id. A role fills
 * the first exposed field with it (all of them for a list). Field ids win over roles.
 */
export type Scalar = string | number | boolean | null;

export function workflowValues(r: RecipeSummary, byRole: Partial<Record<Role, Scalar | Scalar[]>> = {}, byField: Record<string, Scalar> = {}): { values: Record<string, InputValue>; unknown: string[] } {
  const values: Record<string, InputValue> = {};
  const unknown: string[] = [];
  const rank = (f: Field) => (f.exposed ? 0 : 1) + (f.advanced ? 1 : 0);
  // The command line reads "007" as a number and "true" as a yes; a text field gets them back as typed.
  const as = (f: Field, x: Scalar): Scalar => (f.kind === "text" || f.kind === "choice" || f.kind === "image" || f.kind === "video" || f.kind === "audio") && x !== null ? String(x) : x;
  for (const [role, v] of Object.entries(byRole) as [Role, Scalar | Scalar[]][]) {
    const fields = r.fields.filter((f) => f.role === role).sort((a, b) => rank(a) - rank(b));
    if (!fields.length) {
      unknown.push(`role "${role}"`);
      continue;
    }
    const list = Array.isArray(v) ? v : [v];
    list.forEach((x, i) => fields[i] && (values[fields[i].id] = as(fields[i], x)));
  }
  for (const [id, v] of Object.entries(byField)) {
    const f = r.fields.find((x) => x.id === id);
    if (f) values[id] = as(f, v);
    else unknown.push(`field "${id}"`);
  }
  return { values, unknown };
}

export const workflowSpec = (recipe: string, values: Record<string, InputValue>): WorkflowSpec => ({ kind: "workflow", recipe, values });

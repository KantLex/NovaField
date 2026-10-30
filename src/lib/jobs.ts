// Job shape shared by the server and the UI.

import type { Compiled } from "./engines";
import { LOOKS } from "./cinema/looks";
import type { QcReport } from "./qc";
import type { GradeSpec, ImageSpec, JobKind, JobSpec } from "./engines/specs";

export type JobStatus = "preparing" | "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  spec: JobSpec;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  promptId?: string;
  /** Pending prompts ahead of this one on the shared server. */
  ahead?: number;
  progress: { stage: string; pct: number; step?: number; steps?: number };
  meta?: Compiled["meta"];
  /** Browser URLs for the finished take. */
  video?: string;
  image?: string;
  audio?: string;
  poster?: string;
  strip?: string;
  error?: string;
  favorite?: boolean;
  dryRun?: boolean;
  /** Project (folder) id; none means Unsorted. */
  project?: string;
  /** Shot QC: faults found in a finished clip. */
  qc?: QcReport;
}

/** What a take is: from its file once it has one, else from what its engine makes. */
export function outputOf(j: Job): "video" | "image" | "audio" | null {
  if (j.video) return "video";
  if (j.image) return "image";
  if (j.audio) return "audio";
  if (j.meta?.output) return j.meta.output;
  if (j.kind === "image") return "image";
  if (j.kind === "grade") return "video";
  // A shot on the built-in engine is always MiniMax H3 video.
  return j.spec.kind === "shot" && !j.spec.engine ? "video" : null;
}

export const isLive = (j: Job) => j.status === "preparing" || j.status === "queued" || j.status === "running";

export function titleFor(spec: JobSpec, recipe?: { name: string; fields: { id: string; role: string; value: unknown }[] }): string {
  const promptField = recipe?.fields.find((f) => f.role === "prompt");
  const workflowText = spec.kind === "workflow" && promptField ? String(spec.values[promptField.id] ?? promptField.value ?? "") : "";
  const text =
    spec.kind === "workflow"
      ? `${recipe?.name ?? "Workflow"}${workflowText ? `: ${workflowText}` : ""}`
      : spec.kind === "shot"
      ? spec.prompt
      : spec.kind === "recast"
        ? `Recast: ${spec.notes || spec.character.label || "new lead"}`
        : spec.kind === "restyle"
          ? `Restyle: ${spec.style}`
          : spec.kind === "replace"
            ? `Replace: ${spec.prompt}`
            : spec.kind === "image"
              ? imageTitle(spec)
              : spec.kind === "grade"
                ? gradeTitle(spec)
              : `Paths: ${spec.prompt || "motion"}`;
  const clean = text.replace(/\s+/g, " ").replace(/@([\p{L}\p{N}_-]+)/gu, "$1").trim();
  return clean.length > 72 ? `${clean.slice(0, 70)}…` : clean || "Untitled";
}

/** "Edit: make it night", "Upscale ×2: Hero still", "Expand to 16:9". */
function imageTitle(spec: ImageSpec) {
  const source = spec.image.label ? `: ${spec.image.label}` : "";
  if (spec.tool === "edit") return `Edit: ${spec.prompt}`;
  if (spec.tool === "upscale") return `Upscale ×${spec.scale ?? 2}${source}`;
  return `Expand to ${spec.aspect ?? "16:9"}${spec.prompt.trim() ? `: ${spec.prompt}` : source}`;
}

/** "Grade: Noir, Alley push"; with continuity and motion: "Grade: Noir, matched, 180° shutter, Alley push". */
function gradeTitle(spec: GradeSpec) {
  const f = spec.film;
  const graded = f.look !== "none" && f.intensity > 0;
  const parts = [
    ...(graded ? [LOOKS.find((l) => l.id === f.look)?.label ?? f.look] : []),
    ...(spec.match ? ["matched"] : []),
    ...(spec.motion && spec.motion.shutter > 0 ? [`${Math.round(spec.motion.shutter)}° shutter`] : []),
    ...(spec.motion && Math.abs(spec.motion.speed - 1) > 1e-3 ? [`${spec.motion.speed}× speed`] : []),
  ];
  return `Grade: ${[...(parts.length ? parts : ["lens and film"]), ...(spec.source.label ? [spec.source.label] : [])].join(", ")}`;
}

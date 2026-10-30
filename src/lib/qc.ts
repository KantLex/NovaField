// Shot QC reports from NovaShotQC (comfyui-novafield/nova/shot_qc.py): faults found in a take.

export type QcKind = "frozen" | "jump" | "flicker" | "soft" | "blown" | "crushed";

export interface QcIssue {
  kind: QcKind;
  /** Frames, inclusive. */
  start: number;
  end: number;
  severity: "low" | "medium" | "high";
  /** Blown or crushed: the share of the picture affected. */
  amount?: number;
}

export interface QcReport {
  version: number;
  frames: number;
  fps: number;
  /** 100 is clean; each fault takes some off. */
  score: number;
  issues: QcIssue[];
  curves: { brightness: number[]; motion: number[]; sharpness: number[] };
  /** When NovaField checked it. */
  checkedAt?: number;
}

export const QC_LABEL: Record<QcKind, { label: string; note: string }> = {
  frozen: { label: "Frozen frames", note: "The picture stops while the rest of the take moves." },
  jump: { label: "Jump", note: "One frame lurches or morphs much more than the motion around it." },
  flicker: { label: "Flicker", note: "The brightness pops for a frame." },
  soft: { label: "Soft frames", note: "Focus drops for a few frames." },
  blown: { label: "Blown highlights", note: "Bright areas are clipped to white." },
  crushed: { label: "Crushed shadows", note: "Much of the picture is pure black." },
};

/** A take worth a second look: anything serious, or a score under 85. */
export const needsLook = (r: QcReport) => r.score < 85 || r.issues.some((i) => i.severity === "high");

/** Seconds into the take where an issue starts. */
export const issueTime = (r: QcReport, i: QcIssue) => i.start / (r.fps || 24);

// Prices of ComfyUI API nodes, in the shape the interface shows them. Kept apart from the
// formula evaluator (pricing.ts) so the browser never loads it.

/** Comfy bills in credits; its interface converts at 211 credits to the dollar. */
export const CREDITS_PER_USD = 211;

export interface NodePrice {
  node: string;
  classType: string;
  /** Null when the formula has no number for these settings. */
  minUsd: number | null;
  maxUsd: number | null;
  approximate: boolean;
  /** "per 1K tokens", "/30 frames"…: the price scales with something only known at run time. */
  per: string | null;
  text: string | null;
}

export interface GraphPrice {
  minUsd: number;
  maxUsd: number;
  /** Some part is an estimate (a range, a per-unit rate, or a node with no number). */
  approximate: boolean;
  nodes: NodePrice[];
}

/** "≈ 25 credits", "25–51 credits"; credits rounded like ComfyUI's own badges. */
export function formatCredits(minUsd: number, maxUsd: number, approximate: boolean): string {
  const c = (usd: number) => {
    const v = usd * CREDITS_PER_USD;
    return v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toLocaleString("en-US");
  };
  const lo = c(minUsd);
  const hi = c(maxUsd);
  return `${approximate && lo === hi ? "≈ " : ""}${lo === hi ? lo : `${lo}–${hi}`}`;
}

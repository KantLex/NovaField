// The credit guard: whether a render's preflight price fits a ceiling the person agreed to.
// Agents (MCP server, CLI) and the jobs route all use it, so a paid API node never runs unbounded.

import { CREDITS_PER_USD, type GraphPrice } from "./credits";

/** What the guard needs from a preflight. */
export interface PriceCheck {
  paid: string[];
  price: GraphPrice | null;
  blocker?: string | null;
  /** The server couldn't be asked which nodes are paid, so "no paid nodes" means nothing. */
  unpriced?: boolean;
}

export interface Budget {
  ok: boolean;
  /** Credits the render may cost, lowest and highest (0 for local GPU work). */
  credits: { min: number; max: number };
  /** Why it was refused. */
  reason: string | null;
}

const round = (c: number) => Math.round(c * 10) / 10;
/** The ceiling is compared with the top price rounded up, so rounding never lets a run slip over. */
const roundUp = (c: number) => Math.max(0, Math.ceil(c * 10 - 1e-9) / 10);

/**
 * "/Image", "per video": a price per thing the node makes, one per run, so it is the run's price.
 * Rates by tokens, seconds or frames scale with what only the run knows, and stay open-ended.
 */
export const perItem = (per: string) => /^(\/|per)\s*(image|video|generation|request|output|model|clip)s?$/i.test(per.trim());

/** Credits for one preflight; null when a paid node has no number we can trust. */
export function creditsOf(p: PriceCheck): { min: number; max: number } | { unknown: string } {
  if (!p.paid.length) return { min: 0, max: 0 };
  if (!p.price) return { unknown: `the price of ${p.paid.join(", ")} could not be worked out` };
  const open = p.price.nodes.find((n) => n.minUsd === null || n.maxUsd === null);
  if (open) return { unknown: `${open.classType} has no fixed price for these settings${open.text ? ` (“${open.text}”)` : ""}` };
  const rate = p.price.nodes.find((n) => n.per && !perItem(n.per));
  if (rate) return { unknown: `${rate.classType} is billed ${rate.per}, which is only known once it runs` };
  const max = roundUp(p.price.maxUsd * CREDITS_PER_USD);
  return { min: p.price.minUsd === p.price.maxUsd ? max : round(p.price.minUsd * CREDITS_PER_USD), max };
}

/**
 * Check one or more renders (several takes, or one take per spec) against a ceiling in credits.
 * Refuses when anything is blocked, when a paid price is open-ended, or when the highest total
 * price is over the ceiling.
 */
export function checkBudget(checks: PriceCheck[], maxCredits: number): Budget {
  let min = 0;
  let max = 0;
  for (const c of checks) {
    if (c.blocker) return { ok: false, credits: { min, max }, reason: c.blocker };
    if (c.unpriced) return { ok: false, credits: { min, max }, reason: `Refused: ComfyUI couldn't be reached to price this workflow, so it can't be held under ${maxCredits} credits. Try again once it's back.` };
    const cr = creditsOf(c);
    if ("unknown" in cr) return { ok: false, credits: { min, max }, reason: `Refused: ${cr.unknown}, so it can't be held under ${maxCredits} credits.` };
    min += cr.min;
    max += cr.max;
  }
  const credits = { min: round(min), max: roundUp(max) };
  if (!Number.isFinite(maxCredits) || maxCredits < 0) return { ok: false, credits, reason: "max_credits must be 0 or more." };
  if (credits.max > maxCredits) {
    const range = credits.min === credits.max ? `${credits.max}` : `${credits.min}–${credits.max}`;
    return { ok: false, credits, reason: `Refused: this would cost up to ${range} credits, over the ${maxCredits}-credit ceiling.` };
  }
  return { ok: true, credits, reason: null };
}

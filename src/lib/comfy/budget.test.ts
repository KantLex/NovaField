import { describe, expect, it } from "vitest";
import { checkBudget, creditsOf, perItem, type PriceCheck } from "./budget";
import { CREDITS_PER_USD, type NodePrice } from "./credits";

const node = (usd: number | null, extra: Partial<NodePrice> = {}): NodePrice => ({ node: "1", classType: "PaidNode", minUsd: usd, maxUsd: usd, approximate: false, per: null, text: null, ...extra });
const paid = (...nodes: NodePrice[]): PriceCheck => ({
  paid: nodes.map((n) => n.classType),
  price: { minUsd: nodes.reduce((t, n) => t + (n.minUsd ?? 0), 0), maxUsd: nodes.reduce((t, n) => t + (n.maxUsd ?? 0), 0), approximate: false, nodes },
});
const local: PriceCheck = { paid: [], price: null };
const usd = (credits: number) => credits / CREDITS_PER_USD;

describe("credit guard", () => {
  it("lets local GPU work through at 0 credits", () => {
    expect(checkBudget([local, local], 0)).toEqual({ ok: true, credits: { min: 0, max: 0 }, reason: null });
  });

  it("allows a paid run at or under the ceiling and refuses one over it", () => {
    expect(checkBudget([paid(node(usd(20)))], 20).ok).toBe(true);
    const over = checkBudget([paid(node(usd(25)))], 20);
    expect(over.ok).toBe(false);
    expect(over.credits.max).toBe(25);
    expect(over.reason).toMatch(/up to 25 credits, over the 20-credit ceiling/);
  });

  it("refuses a workflow it couldn't price because the server was unreachable", () => {
    const r = checkBudget([{ paid: [], price: null, unpriced: true }], 100);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/couldn't be reached/);
  });

  it("adds up several takes", () => {
    const takes = [paid(node(usd(8))), paid(node(usd(8))), paid(node(usd(8)))];
    expect(checkBudget(takes, 24).ok).toBe(true);
    expect(checkBudget(takes, 23.9).ok).toBe(false);
  });

  it("compares against the top of a price range", () => {
    const range = paid(node(null, { minUsd: usd(10), maxUsd: usd(30), approximate: true }));
    expect(checkBudget([range], 20).ok).toBe(false);
    expect(checkBudget([range], 30)).toMatchObject({ ok: true, credits: { min: 10, max: 30 } });
  });

  it("rounds the top price up, never down", () => {
    expect(checkBudget([paid(node(usd(12.01)))], 12)).toMatchObject({ ok: false, credits: { min: 12.1, max: 12.1 } });
  });

  it("refuses paid nodes it can't price", () => {
    expect(checkBudget([{ paid: ["PaidNode"], price: null }], 1000).reason).toMatch(/could not be worked out/);
    expect(checkBudget([paid(node(null, { text: "Varies" }))], 1000).reason).toMatch(/no fixed price.*Varies/);
    expect(checkBudget([paid(node(0.001, { per: "per 1K tokens" }))], 1000).reason).toMatch(/billed per 1K tokens/);
  });

  it("takes a price per image or video as the run's price", () => {
    expect(perItem("/Image")).toBe(true);
    expect(perItem("per video")).toBe(true);
    expect(perItem("/second")).toBe(false);
    expect(perItem("/30 frames")).toBe(false);
    expect(creditsOf(paid(node(usd(12.4), { per: "/Image", approximate: true })))).toEqual({ min: 12.4, max: 12.4 });
  });

  it("refuses anything blocked, whatever the ceiling", () => {
    expect(checkBudget([{ ...local, blocker: "Needs an API key." }], 1e9)).toMatchObject({ ok: false, reason: "Needs an API key." });
  });

  it("refuses a negative or missing ceiling", () => {
    expect(checkBudget([local], -1).ok).toBe(false);
    expect(checkBudget([local], Number.NaN).ok).toBe(false);
  });
});

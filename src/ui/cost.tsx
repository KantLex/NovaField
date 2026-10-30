"use client";

// Where a render runs and what it costs: open models on a GPU (yours or Comfy Cloud's) are
// free per take here; ComfyUI API nodes bill the Comfy account per run, priced by ComfyUI itself.

import clsx from "clsx";
import { Cloud, Cpu } from "lucide-react";
import { formatCredits, type GraphPrice } from "@/lib/comfy/credits";
import { tr } from "@/i18n";
import { useLive } from "./state";

const usd = (v: number) => (v < 0.1 ? `$${+v.toFixed(3)}` : `$${v.toFixed(2)}`);

/** "≈ 25 credits" for one run; null when ComfyUI gives no number for it. */
export function creditsLabel(price: GraphPrice | null | undefined): string | null {
  if (!price || (price.maxUsd === 0 && price.nodes.every((n) => n.maxUsd == null))) return null;
  return tr("{credits} credits", { credits: formatCredits(price.minUsd, price.maxUsd, price.approximate) });
}

/** One line per paid node, for a tooltip: "KlingVideoNode: $0.35 per 5 s". */
export function priceDetail(price: GraphPrice): string {
  return price.nodes
    .map((n) => {
      const cost = n.minUsd == null ? (n.text ?? tr("price unknown")) : n.minUsd === n.maxUsd ? usd(n.minUsd) : `${usd(n.minUsd)}–${usd(n.maxUsd!)}`;
      return `${n.classType}: ${cost}${n.per ? ` ${n.per}` : ""}`;
    })
    .join("\n");
}

/** Dollars for the same run: "$0.12" or "$0.05–$0.15". */
export const usdLabel = (price: GraphPrice) => (price.minUsd === price.maxUsd ? usd(price.minUsd) : `${usd(price.minUsd)}–${usd(price.maxUsd)}`);

/** "Local" or "API" chip for an engine. `paid` are the API node types it uses. */
export function EngineSource({ paid, className }: { paid: string[] | undefined; className?: string }) {
  const cloud = useLive((s) => s.status?.mode === "cloud");
  const api = (paid?.length ?? 0) > 0;
  const Icon = api ? Cloud : Cpu;
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold", api ? "bg-daylight/15 text-daylight" : "bg-ink/10 text-ink", className)}
      title={tr(
        api
          ? "Runs on a paid API through your Comfy account; each take costs credits."
          : cloud
            ? "An open model running on Comfy Cloud's GPUs."
            : "An open model running on your own GPU: no per-take cost.",
      )}
    >
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      {tr(api ? "API model" : cloud ? "Cloud GPU" : "Local model")}
    </span>
  );
}

/** Short tag for an engine inside a plain <select> option. */
export const sourceTag = (paid: string[] | undefined, cloud: boolean) => tr((paid?.length ?? 0) > 0 ? "API" : cloud ? "Cloud GPU" : "Local");

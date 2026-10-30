"use client";

import clsx from "clsx";
import { Check, ChevronDown, ExternalLink, LoaderCircle, Package, RefreshCw, RotateCcw, Search, Star, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { blockingMissing, isDisplayOnly } from "@/lib/workflows/missing";
import type { RecipeSummary } from "@/lib/workflows/types";
import { fail, packs, request, toast, type PackTask } from "../api";
import { Button } from "../controls";
import { useLive, type ServerStatus } from "../state";
import { tr } from "@/i18n";
import { forgetObjectInfo } from "@/ui/graph/info";

interface Pack {
  id: string;
  title: string;
  author: string | null;
  description: string | null;
  repository: string | null;
  stars: number | null;
  registry: boolean;
  covers: string[];
  installed: boolean;
  displayOnly: boolean;
}
interface Plan {
  manager: { available: boolean; version: string | null };
  packs: Pack[];
  unknown: string[];
  canRecheck: boolean;
}
type Phase = "review" | "confirm" | "installing" | "restart" | "restarting" | "checking";

const STEPS = ["Install packs", "Restart ComfyUI", "Check again"] as const;
const stars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/**
 * Turns "the server is missing 22 nodes" into the few packs that provide them, and walks the
 * person through installing them with ComfyUI Manager, restarting, and checking again.
 */
export function MissingPacks({ recipe, onRecipe }: { recipe: RecipeSummary; onRecipe: (r: RecipeSummary) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("review");
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, PackTask>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const comfyUrl = useLive((s) => s.status?.url);

  // Bumped to look the packs up again (after installing and checking).
  const [lookup, setLookup] = useState(0);
  useEffect(() => {
    let alive = true;
    request<Plan>(`/api/workflows/${recipe.id}/packs`)
      .then((r) => {
        if (!alive) return;
        setError(null);
        setPlan(r);
        setPicked(new Set((r.packs as Pack[]).filter((p) => !p.installed && !p.displayOnly).map((p) => p.id)));
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [recipe.id, lookup]);

  // Follow the installs until each one has finished.
  useEffect(() => {
    if (phase !== "installing") return;
    const t = setInterval(async () => {
      const s = await packs.status(tasks);
      setStates(s);
      const all = Object.values(s);
      if (all.length && all.every((x) => x.state !== "waiting")) {
        clearInterval(t);
        setPhase(all.some((x) => x.state === "done") ? "restart" : "review");
        if (all.every((x) => x.state === "failed")) toast("No pack installed. The reasons are under each pack.", "error");
      }
    }, 2500);
    return () => clearInterval(t);
  }, [phase, tasks]);

  const recheck = async () => {
    setPhase("checking");
    try {
      const r = await request<RecipeSummary>(`/api/workflows/${recipe.id}/recheck`, { method: "POST" });
      // Graph mode keeps the node list for the page: let it load the one with the new packs.
      forgetObjectInfo();
      onRecipe(r);
      const left = blockingMissing(r.missing);
      toast(
        left.length > 1 ? tr("{n} node types are still missing.", { n: left.length }) : left.length ? tr("1 node type is still missing.") : tr("Everything this workflow needs is installed."),
        left.length ? "error" : "done",
      );
      setTasks({});
      setStates({});
      setLookup((n) => n + 1);
    } catch (e) {
      fail(e);
    } finally {
      setPhase("review");
    }
  };

  const install = async () => {
    if (!plan) return;
    const chosen = plan.packs.filter((p) => picked.has(p.id)).map((p) => ({ id: p.id, registry: p.registry, repository: p.repository }));
    setPhase("installing");
    try {
      const r = await packs.install(chosen);
      setTasks(r.tasks);
      setStates(Object.fromEntries(Object.keys(r.tasks).map((k) => [k, { state: "waiting" }])));
    } catch (e) {
      fail(e);
      setPhase("review");
    }
  };

  const restart = async (force = false) => {
    let stopping: number | null;
    try {
      stopping = await packs.restart(force);
    } catch (e) {
      return fail(e);
    }
    if (stopping !== null) return setBusy(stopping);
    setBusy(null);
    setPhase("restarting");
    // Wait for ComfyUI to go away and come back, then read the workflow again.
    const started = Date.now();
    await new Promise((res) => setTimeout(res, 5000));
    while (Date.now() - started < 240_000) {
      const s = await request<ServerStatus>("/api/status").catch(() => null);
      if (s?.online && s.nodeCount > 0) return recheck();
      await new Promise((res) => setTimeout(res, 3000));
    }
    setPhase("restart");
    toast("ComfyUI hasn't come back after 4 minutes. Check the PC, then press Check again.", "error");
  };

  const blocking = blockingMissing(recipe.missing);
  const skipped = recipe.missing.filter(isDisplayOnly);
  const step = phase === "installing" || phase === "confirm" || phase === "review" ? 0 : phase === "restart" || phase === "restarting" ? 1 : 2;
  const pickedPacks = plan?.packs.filter((p) => picked.has(p.id)) ?? [];

  if (!blocking.length) {
    return skipped.length ? (
      <p className="text-[12px] text-dim">
        {skipped.length > 1
          ? tr("Skipping {names}: they only show values on the ComfyUI canvas, so NovaField runs without them.", { names: skipped.join(", ") })
          : tr("Skipping {names}: it only shows values on the ComfyUI canvas, so NovaField runs without it.", { names: skipped.join(", ") })}
      </p>
    ) : null;
  }

  return (
    <section className="flex flex-col gap-4 rounded-md border border-line/70 bg-surround/60 p-4" aria-label={tr("Missing node packs")}>
      <div className="flex flex-wrap items-start gap-3">
        <Package className="mt-0.5 text-tungsten" size={20} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{tr("Install what this workflow needs")}</h2>
          <p className="mt-0.5 text-[13px] text-dim">
            {plan
              ? tr("Missing node types: {n}. They come from {packs} packs.", { n: recipe.missing.length, packs: plan.packs.length }) +
                (plan.unknown.length ? ` ${tr("Not in any known pack: {n}.", { n: plan.unknown.length })}` : "")
              : tr("Missing node types on your ComfyUI: {n}.", { n: recipe.missing.length })}
          </p>
        </div>
        {plan?.canRecheck && (
          <Button onClick={recheck} disabled={phase === "checking" || phase === "installing" || phase === "restarting"}>
            {phase === "checking" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} {tr("Check again")}
          </Button>
        )}
      </div>

      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]" aria-label={tr("Steps")}>
        {STEPS.map((s, i) => (
          <li key={s} className={clsx("flex items-center gap-1.5", i < step ? "text-ok" : i === step ? "text-ink" : "text-faint")}>
            <span className={clsx("flex size-4 items-center justify-center rounded-full text-[10px] font-semibold", i < step ? "bg-ok text-surround" : i === step ? "bg-ink text-surround" : "bg-raised")}>
              {i < step ? <Check size={10} /> : i + 1}
            </span>
            {tr(s)}
          </li>
        ))}
      </ol>

      {error && (
        <div className="flex flex-col gap-2 text-[13px]">
          <p className="text-tally">{error}</p>
          <RawList missing={recipe.missing} />
        </div>
      )}
      {!plan && !error && (
        <p className="flex items-center gap-2 text-[13px] text-dim">
          <LoaderCircle size={14} className="animate-spin" /> {tr("Looking up which packs provide these nodes…")}
        </p>
      )}
      {plan && !plan.manager.available && (
        <div className="flex flex-col gap-2 text-[13px] text-dim">
          <p>{tr("ComfyUI Manager isn't reachable on your server, so NovaField can't look up or install packs. In ComfyUI, open Manager → Install Missing Custom Nodes with this workflow loaded, then press Check again.")}</p>
          <RawList missing={recipe.missing} />
        </div>
      )}

      {plan && plan.manager.available && (
        <ul className="flex flex-col divide-y divide-line/50 rounded-md bg-panel">
          {plan.packs.map((p) => {
            const st = states[p.id];
            return (
              <li key={p.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    disabled={phase !== "review"}
                    onChange={(e) => setPicked((s) => (e.target.checked ? new Set(s).add(p.id) : new Set([...s].filter((x) => x !== p.id))))}
                    className="accent-tungsten"
                    aria-label={tr("Install {name}", { name: p.title })}
                  />
                  <span className="text-[14px] font-semibold">{p.title}</span>
                  {p.author && <span className="text-[12px] text-dim">{tr("by {name}", { name: p.author })}</span>}
                  {p.stars !== null && (
                    <span className="readout flex items-center gap-0.5 text-[13px] text-dim">
                      <Star size={11} /> {stars(p.stars)}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3 text-[12px]">
                    {st && <TaskPill state={st} />}
                    <button onClick={() => setOpen(open === p.id ? null : p.id)} className="flex items-center gap-1 text-dim hover:text-ink" aria-expanded={open === p.id}>
                      {p.covers.length > 1 ? tr("Provides {n} nodes", { n: p.covers.length }) : tr("Provides 1 node")} <ChevronDown size={12} className={clsx("transition-transform", open === p.id && "rotate-180")} />
                    </button>
                    {p.repository && (
                      <a href={p.repository} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-dim hover:text-ink">
                        GitHub <ExternalLink size={11} />
                      </a>
                    )}
                  </span>
                </div>
                {p.description && <p className="pl-7 text-[12px] text-dim">{p.description}</p>}
                <div className="flex flex-wrap gap-2 pl-7 text-[11px]">
                  {p.displayOnly && <span className="rounded bg-raised px-1.5 py-0.5 text-dim">{tr("Optional: only shows values on the canvas")}</span>}
                  {p.installed && <span className="rounded bg-tally/15 px-1.5 py-0.5 text-tally">{tr("Already installed but failed to load. Check ComfyUI's console, or reinstall it in Manager.")}</span>}
                  {!p.registry && <span className="rounded bg-raised px-1.5 py-0.5 text-dim">{tr("Only on GitHub, not in the Comfy Registry")}</span>}
                </div>
                {open === p.id && <p className="readout pl-7 text-[13px] break-words text-faint">{p.covers.join(", ")}</p>}
                {st?.state === "failed" && st.message && <p className="pl-7 text-[12px] text-tally">{st.message}</p>}
              </li>
            );
          })}
          {plan.unknown.map((n) => (
            <li key={n} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5">
              <TriangleAlert size={14} className="mt-0.5 text-tally" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">
                  <span className="readout text-[15px]">{n}</span> {tr("isn't in any known pack")}
                </p>
                <p className="text-[12px] text-dim">{tr("It may come from a private or hosted pack. Search for it, or open the workflow in ComfyUI and swap that node for one you have.")}</p>
              </div>
              <a href={`https://github.com/search?q=${encodeURIComponent(`"${n}"`)}&type=code`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-dim hover:text-ink">
                <Search size={12} /> {tr("Search GitHub")}
              </a>
            </li>
          ))}
        </ul>
      )}

      {plan?.manager.available && (
        <div className="flex flex-col gap-3">
          {phase === "review" && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="solid" disabled={!pickedPacks.length} onClick={() => setPhase("confirm")}>
                {pickedPacks.length === 1 ? tr("Install 1 pack") : tr("Install {n} packs", { n: pickedPacks.length })}
              </Button>
              {comfyUrl && (
                <a href={comfyUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12px] text-dim hover:text-ink">
                  Or install them yourself in ComfyUI <ExternalLink size={11} />
                </a>
              )}
            </div>
          )}

          {phase === "confirm" && (
            <div className="flex flex-col gap-2 rounded-md bg-tungsten/10 p-3 text-[13px]">
              <p>
                {tr(
                  pickedPacks.length === 1
                    ? "This downloads code from 1 GitHub project ({names}) and runs it on your ComfyUI PC, along with any Python packages it needs. Only continue if you trust it."
                    : "This downloads code from {n} GitHub projects ({names}) and runs it on your ComfyUI PC, along with any Python packages they need. Only continue if you trust them.",
                  { n: pickedPacks.length, names: pickedPacks.map((p) => p.title).join(", ") },
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="solid" onClick={install}>
                  {tr("Install")}
                </Button>
                <Button onClick={() => setPhase("review")}>{tr("Cancel")}</Button>
              </div>
            </div>
          )}

          {phase === "installing" && (
            <p className="flex items-center gap-2 text-[13px] text-dim">
              <LoaderCircle size={14} className="animate-spin" /> {tr("ComfyUI Manager is installing. Big packs can take a few minutes.")}
            </p>
          )}

          {(phase === "restart" || phase === "restarting") && (
            <div className="flex flex-col gap-2 rounded-md bg-panel p-3 text-[13px]">
              <p>{tr("New packs load when ComfyUI restarts. Restarting takes about a minute; NovaField checks the workflow again as soon as ComfyUI is back.")}</p>
              {busy !== null && (
                <p className="text-tally">
                  {busy > 1
                    ? tr("ComfyUI is busy with {n} jobs right now, possibly from other apps or people. Restarting stops them.", { n: busy })
                    : tr("ComfyUI is busy with 1 job right now, possibly from other apps or people. Restarting stops it.")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {phase === "restarting" ? (
                  <span className="flex items-center gap-2 text-dim">
                    <LoaderCircle size={14} className="animate-spin" /> {tr("Waiting for ComfyUI to come back…")}
                  </span>
                ) : busy !== null ? (
                  <>
                    <Button variant="danger" onClick={() => restart(true)}>
                      {tr("Restart anyway")}
                    </Button>
                    <Button onClick={() => setBusy(null)}>{tr("Wait")}</Button>
                  </>
                ) : (
                  <Button variant="solid" onClick={() => restart(false)}>
                    <RotateCcw size={14} /> {tr("Restart ComfyUI")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {!plan?.canRecheck && plan && <p className="text-[12px] text-faint">{tr("This workflow was imported before NovaField kept the original file. After installing, remove it and import the .json again.")}</p>}
    </section>
  );
}

function TaskPill({ state }: { state: PackTask }) {
  if (state.state === "waiting")
    return (
      <span className="flex items-center gap-1 text-dim">
        <LoaderCircle size={12} className="animate-spin" /> {tr("Installing")}
      </span>
    );
  if (state.state === "done")
    return (
      <span className="flex items-center gap-1 text-ok">
        <Check size={12} /> {tr("Installed")}
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-tally">
      <X size={12} /> {tr("Failed")}
    </span>
  );
}

function RawList({ missing }: { missing: string[] }) {
  return <p className="readout text-[13px] break-words text-faint">{missing.join(", ")}</p>;
}

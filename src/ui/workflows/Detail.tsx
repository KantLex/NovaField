"use client";

// One workflow open: run it with a form, or customise which inputs the form shows.

import clsx from "clsx";
import { ChevronDown, Play, SlidersHorizontal, Trash2, Workflow } from "lucide-react";
import type { GraphPrice } from "@/lib/comfy/credits";
import { useEffect, useMemo, useState } from "react";
import type { InputValue } from "@/lib/comfy/graph";
import { isEngine } from "@/lib/workflows/apply";
import { blockingMissing } from "@/lib/workflows/missing";
import type { Field, RecipeSummary, Role } from "@/lib/workflows/types";
import { api, fail, request, toast } from "@/ui/api";
import { Button } from "@/ui/controls";
import { creditsLabel, EngineSource, priceDetail, usdLabel } from "@/ui/cost";
import { TakeActions } from "@/ui/TakeActions";
import { TakePlayer } from "@/ui/TakePlayer";
import { useLive } from "@/ui/state";
import { FieldInput } from "@/ui/workflows/FieldInput";
import { GraphEditor } from "@/ui/graph/GraphEditor";
import { MissingPacks } from "@/ui/workflows/MissingPacks";
import { SizeField } from "@/ui/workflows/SizeField";
import { useForms, useRecipes } from "@/ui/workflows/store";
import { useUnsaved } from "@/ui/unsaved";
import { tr } from "@/i18n";

export const OUTPUT_LABEL = {
  video: "Makes video",
  image: "Makes images",
  audio: "Makes audio",
  unknown: "Output unknown",
};

export type Detailed = RecipeSummary & { nodes: number };

export type Mode = "run" | "customise" | "graph";

export const MODES: { id: Mode; label: string; title: string }[] = [
  { id: "run", label: "Run", title: "Fill in the form and run" },
  { id: "customise", label: "Form", title: "Choose what the form shows and what it's called" },
  { id: "graph", label: "Graph", title: "Edit the nodes and wires themselves" },
];

export function Detail({ id, onDeleted, initialMode = "run" }: { id: string; onDeleted: () => void; initialMode?: Mode }) {
  const [recipe, setRecipe] = useState<Detailed | null>(null);
  const [mode, setModeRaw] = useState<Mode>(initialMode);
  const [graphDirty, setGraphDirty] = useState(false);
  const setMode = (m: Mode) => {
    if (mode === "graph" && graphDirty && m !== "graph" && !confirm(tr("Leave graph mode without saving your changes?"))) return;
    setModeRaw(m);
  };
  const { upsert, drop } = useRecipes();

  useEffect(() => {
    request<Detailed>(`/api/workflows/${id}`)
      .then(setRecipe)
      .catch(() => setRecipe(null));
  }, [id]);

  if (!recipe) return <div className="rounded-md bg-panel p-6 text-[13px] text-dim">{tr("Loading…")}</div>;
  const blocked = blockingMissing(recipe.missing).length > 0;

  const save = async (patch: { name?: string; fields?: Partial<Field>[] }) => {
    try {
      const r = await request<RecipeSummary>(`/api/workflows/${id}`, { method: "PATCH", json: patch });
      setRecipe({ ...r, nodes: recipe.nodes });
      upsert(r);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-md bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <input
            defaultValue={recipe.name}
            onBlur={(e) => e.target.value.trim() !== recipe.name && save({ name: e.target.value })}
            className="display w-full rounded bg-transparent text-[22px] leading-tight focus:bg-surround focus:outline-none"
            aria-label={tr("Workflow name")}
          />
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-faint">
            <span>{recipe.source}</span>
            {blocked ? (
              <span className="text-tungsten">{tr("Can't run until its node packs are installed")}</span>
            ) : (
              <>
                <span>{tr("{n} nodes", { n: recipe.nodes })}</span>
                <span>{tr(OUTPUT_LABEL[recipe.output])}</span>
              </>
            )}
            {isEngine(recipe) && <span className="text-tungsten">{tr("Pick it as a model in Studio")}</span>}
          </p>
        </div>
        <div className="flex gap-0.5 rounded-md bg-surround p-0.5" role="tablist" aria-label={tr("View")}>
          {MODES.filter((m) => !blocked || m.id === "graph" || m.id === mode).map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              title={tr(m.title)}
              onClick={() => setMode(m.id)}
              className={clsx("flex items-center gap-1.5 rounded px-3 py-1 text-[13px] transition-colors", mode === m.id ? "bg-raised text-ink" : "text-dim hover:text-ink")}
            >
              {m.id === "graph" ? <Workflow size={13} /> : m.id === "customise" ? <SlidersHorizontal size={13} /> : <Play size={13} />}
              {tr(m.label)}
            </button>
          ))}
        </div>
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm(tr("Remove “{name}” from NovaField? The workflow file itself is not touched.", { name: recipe.name }))) return;
            try {
              await request(`/api/workflows/${id}`, { method: "DELETE" });
            } catch (e) {
              // Still listed on the server: keep it here too.
              return fail(e);
            }
            drop(id);
            onDeleted();
          }}
          aria-label={tr("Remove workflow")}
        >
          <Trash2 size={14} />
        </Button>
      </div>

      {recipe.missing.length > 0 && (
        <MissingPacks
          recipe={recipe}
          onRecipe={(r) => {
            setRecipe({ ...r, nodes: recipe.nodes });
            upsert(r);
          }}
        />
      )}
      {recipe.warnings.map((w) => (
        <p key={w} className="text-[12px] text-tungsten">
          {w}
        </p>
      ))}

      {mode === "graph" ? (
        <GraphEditor
          recipeId={recipe.id}
          fields={recipe.fields}
          onDirty={setGraphDirty}
          onSaved={(r) => {
            setRecipe({ ...r, nodes: recipe.nodes });
            upsert(r);
          }}
        />
      ) : blocked ? null : mode === "run" ? (
        <RunForm recipe={recipe} />
      ) : (
        <Customise recipe={recipe} onSave={save} />
      )}
    </div>
  );
}

export const rank = (f: Field) =>
  f.role === "prompt" ? 0 : f.kind === "image" || f.kind === "video" || f.kind === "audio" ? 1 : f.kind === "text" ? 2 : f.kind === "toggle" ? 4 : 3;

export function RunForm({ recipe }: { recipe: Detailed }) {
  const formValues = useForms((s) => s.values[recipe.id]);
  const values = useMemo(() => formValues ?? {}, [formValues]);
  const setValue = useForms((s) => s.set);
  const setFocus = useLive((s) => s.setFocus);
  const latest = useLive(
    (s) =>
      Object.values(s.jobs)
        .filter((j) => j.spec.kind === "workflow" && j.spec.recipe === recipe.id)
        .sort((a, b) => b.createdAt - a.createdAt)[0],
  );
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [price, setPrice] = useState<GraphPrice | null>(null);
  const apiKey = useLive((s) => s.status?.apiKey);

  const shown = recipe.fields.filter((f) => f.exposed).sort((a, b) => rank(a) - rank(b));
  const main = shown.filter((f) => !f.advanced);
  const extra = shown.filter((f) => f.advanced);
  const valueOf = (f: Field): InputValue => (f.id in values ? values[f.id] : f.kind === "seed" && f.randomize ? (undefined as unknown as InputValue) : f.value);
  const spec = { kind: "workflow" as const, recipe: recipe.id, values };

  const specKey = JSON.stringify(values);
  useEffect(() => {
    if (blockingMissing(recipe.missing).length) return;
    const t = setTimeout(() => {
      api
        .preflight(spec)
        .then((r) => {
          setIssues([...(r.blocker ? [tr(r.blocker)] : []), ...r.issues.map((i) => `${i.classType}${i.input ? `.${i.input}` : ""}: ${tr(i.message)}`)]);
          setWarnings(r.warnings.map((i) => `${i.classType}: ${tr(i.message)}`));
          setPrice(r.price ?? null);
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, recipe.id]);

  // Width and height together become one Size control (aspect ratio and pixel count).
  const fieldsWithSize = (list: Field[]) => {
    const w = list.find((f) => f.role === "width" && f.kind === "number");
    const h = list.find((f) => f.role === "height" && f.kind === "number");
    return list.map((f) => {
      if (w && h && f === h) return null;
      if (w && h && f === w)
        return (
          <SizeField
            key="size"
            width={w}
            height={h}
            w={valueOf(w)}
            h={valueOf(h)}
            onChange={(width, height) => {
              setValue(recipe.id, w.id, width);
              setValue(recipe.id, h.id, height);
            }}
          />
        );
      return <FieldInput key={f.id} field={f} value={valueOf(f)} onChange={(v) => setValue(recipe.id, f.id, v)} />;
    });
  };

  const run = async () => {
    setBusy(true);
    try {
      const [job] = await api.submit([spec]);
      setFocus(job.id);
      toast(tr("Running “{name}”.", { name: recipe.name }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {main.length === 0 && blockingMissing(recipe.missing).length === 0 && (
          <p className="text-[13px] text-dim">{tr("Nothing to fill in: this workflow runs as saved. Use Customise form to show more of its settings.")}</p>
        )}
        {fieldsWithSize(main)}
        {extra.length > 0 && (
          <div className="flex flex-col gap-3">
            <button onClick={() => setMore((m) => !m)} className="flex items-center gap-1 self-start text-[13px] text-dim hover:text-ink" aria-expanded={more}>
              <ChevronDown size={14} className={clsx("transition-transform", more && "rotate-180")} /> {tr("More settings ({n})", { n: extra.length })}
            </button>
            {more && fieldsWithSize(extra)}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-4">
          <Button variant="solid" className="px-5 py-2 text-[14px]" disabled={busy || blockingMissing(recipe.missing).length > 0} onClick={run}>
            {tr("Run")}
            {(recipe.paid?.length ?? 0) > 0 && <span className="ml-2 font-normal opacity-80">· {creditsLabel(price) ?? tr("Paid API")}</span>}
          </Button>
          <EngineSource paid={recipe.paid} />
          {Object.keys(values).length > 0 && (
            <button onClick={() => useForms.getState().clear(recipe.id)} className="text-[12px] text-dim hover:text-ink">
              {tr("Back to the workflow's own values")}
            </button>
          )}
        </div>
        {(recipe.paid?.length ?? 0) > 0 && apiKey && (
          <p className="text-[12px] text-daylight" title={price ? priceDetail(price) : undefined}>
            {price && creditsLabel(price)
              ? tr("Runs on ComfyUI API nodes ({nodes}): {usd} ({credits}) per run, billed to your Comfy account.", { nodes: recipe.paid!.join(", "), usd: usdLabel(price), credits: creditsLabel(price)! })
              : tr("Runs on ComfyUI API nodes ({nodes}). Each run is billed to your Comfy account.", { nodes: recipe.paid!.join(", ") })}
          </p>
        )}
        {issues.map((i) => (
          <p key={i} className="text-[12px] whitespace-pre-line text-tally">
            {i}
          </p>
        ))}
        {warnings.map((w) => (
          <p key={w} className="text-[12px] text-tungsten">
            {w}
          </p>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[3px] bg-monitor">
          {latest?.status === "done" ? (
            <TakePlayer key={latest.id} job={latest} />
          ) : latest ? (
            <div className="flex flex-col items-center gap-2 text-[13px]">
              <span className="flex items-center gap-2">
                <span
                  className={clsx(
                    "size-2 rounded-full",
                    latest.status === "running" ? "animate-pulse bg-tally" : latest.status === "failed" ? "bg-tally" : "bg-tungsten",
                  )}
                />
                {tr(latest.status === "failed" ? "Failed" : latest.progress.stage)}
              </span>
              {latest.error && <span className="max-w-[90%] text-center text-[12px] whitespace-pre-line text-tally">{tr(latest.error)}</span>}
            </div>
          ) : (
            <span className="text-[13px] text-faint">{tr("Your result shows here")}</span>
          )}
        </div>
        {latest?.status === "done" && <TakeActions job={latest} inline without={["graph"]} />}
      </div>
    </div>
  );
}

export const ROLES: { id: Role; label: string }[] = [
  { id: "none", label: "—" },
  { id: "prompt", label: "Script" },
  { id: "negative", label: "Negative" },
  { id: "image", label: "Picture" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "seed", label: "Seed" },
  { id: "width", label: "Width" },
  { id: "height", label: "Height" },
  { id: "aspect", label: "Aspect" },
  { id: "seconds", label: "Seconds" },
  { id: "frames", label: "Frames" },
  { id: "steps", label: "Steps" },
];

export function Customise({ recipe, onSave }: { recipe: Detailed; onSave: (p: { fields: Partial<Field>[] }) => Promise<void> }) {
  const [fields, setFields] = useState(recipe.fields);
  const dirty = JSON.stringify(fields) !== JSON.stringify(recipe.fields);
  useUnsaved(dirty);
  const groups = useMemo(() => {
    const m = new Map<string, Field[]>();
    for (const f of fields) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, [fields]);
  const edit = (id: string, p: Partial<Field>) => setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[70ch] text-[13px] text-dim">
        {tr(
          "Tick what belongs on the form and name it the way you think of it. “More” tucks a field under More settings. The Studio column tells Studio which field gets its script, first frame, seed, size and length.",
        )}
      </p>
      <div className="hidden grid-cols-[auto_minmax(0,1fr)_110px_auto_auto] gap-3 px-2 text-[12px] text-faint sm:grid">
        <span>{tr("Show")}</span>
        <span>{tr("Label")}</span>
        <span>{tr("Value")}</span>
        <span>{tr("Placement")}</span>
        <span>{tr("Studio")}</span>
      </div>
      <div className="-mt-2 flex flex-col gap-4">
        {groups.map(([group, fs]) => (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="text-[12px] font-semibold text-faint">{group}</h3>
            {fs.map((f) => (
              <div
                key={f.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surround sm:grid-cols-[auto_minmax(0,1fr)_110px_auto_auto]"
              >
                <input
                  type="checkbox"
                  checked={f.exposed}
                  onChange={(e) => edit(f.id, { exposed: e.target.checked })}
                  className="accent-tungsten"
                  aria-label={tr("Show {name}", { name: f.label })}
                />
                <input
                  value={f.label}
                  onChange={(e) => edit(f.id, { label: e.target.value })}
                  className={clsx("min-w-0 rounded bg-transparent px-1 py-0.5 text-[14px] focus:bg-surround focus:outline-none", !f.exposed && "text-faint")}
                />
                <span className="readout hidden truncate text-[13px] text-faint sm:block" title={`${f.input}: ${String(f.value)}`}>
                  {f.kind}: {String(f.value).slice(0, 14)}
                </span>
                <label className="flex items-center gap-1 text-[12px] text-dim">
                  <input type="checkbox" checked={f.advanced} onChange={(e) => edit(f.id, { advanced: e.target.checked })} className="accent-tungsten" />
                  {tr("More")}
                </label>
                <select
                  value={f.role}
                  onChange={(e) => edit(f.id, { role: e.target.value as Role })}
                  className="rounded bg-surround px-1.5 py-0.5 text-[12px]"
                  aria-label={tr("Studio role for {name}", { name: f.label })}
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {tr(r.label)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-line/60 pt-4">
        <Button variant="solid" disabled={!dirty} onClick={() => onSave({ fields })}>
          {tr("Save form")}
        </Button>
        <Button disabled={!dirty} onClick={() => setFields(recipe.fields)}>
          {tr("Discard changes")}
        </Button>
      </div>
    </div>
  );
}

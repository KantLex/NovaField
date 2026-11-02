"use client";

// Henshin's side panel: the model for the mode, each mode's settings and the asset slots it fills.

import clsx from "clsx";
import { ImagePlus, SlidersHorizontal, Workflow, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LOOKS, RESTYLES } from "@/lib/cinema/looks";
import type { Capabilities } from "@/lib/engines/capabilities";
import { HENSHIN_MODELS, henshinReady, workflowFits, type HenshinModelInfo } from "@/lib/engines/henshinModels";
import { isEngine } from "@/lib/workflows/apply";
import type { Asset, BoxKey, Quality } from "@/lib/engines/specs";
import { api, fail } from "@/ui/api";
import { Locked, Section, Segmented } from "@/ui/controls";
import { EngineSource, sourceTag } from "@/ui/cost";
import { Drop } from "@/ui/Drop";
import { NodesCallout } from "@/ui/NodesCallout";
import { tr } from "@/i18n";
import { clearedBy, clipOf, type G, type Mode, modelOf, useG } from "@/ui/henshin/state";
import { useLive } from "@/ui/state";
import { useRecipes } from "@/ui/workflows/store";

export function ModePanel({ caps }: { caps?: Capabilities }) {
  return (
    <>
      <ModelPicker caps={caps} />
      <ModeSettings caps={caps} />
    </>
  );
}

/**
 * Which model the mode runs on, from a list like Studio's: the two recommended first, then any
 * others, then the imported workflows that take what the mode gives (local or paid API). A model
 * the server doesn't have stays choosable and says what it needs. Choosing one whose clip is cut differently (H3's 24 fps
 * or Wan's 16 fps) cuts the same part of the same original again for it.
 */
function ModelPicker({ caps }: { caps?: Capabilities }) {
  const g = useG();
  const current = modelOf(g);
  const chosen = g.models[g.mode] ?? HENSHIN_MODELS[g.mode][0].id;
  const [cutting, setCutting] = useState<string | null>(null);
  const { list: recipes, loaded, refresh } = useRecipes();
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  const cloud = useLive((s) => s.status?.mode === "cloud");
  const list = HENSHIN_MODELS[g.mode];
  const workflows = recipes.filter((r) => workflowFits(r, g.mode));
  const choices: { title: string; items: Choice[] }[] = [
    { title: "Recommended", items: list.filter((m) => m.recommended).map(builtIn) },
    { title: "Also works", items: list.filter((m) => !m.recommended).map(builtIn) },
    {
      title: "Your workflows",
      items: workflows.map((r) => ({
        key: `wf:${r.id}` as const,
        name: r.name,
        blurb: "",
        clip: g.mode === "paths" ? "image" : "h3",
        sound: false,
        ready: true,
        tag: sourceTag(r.paid, cloud),
      })),
    },
  ];

  const choose = async (m: Choice) => {
    if (m.key === chosen || cutting) return;
    const models = { ...g.models, [g.mode]: m.key };
    const sound = !m.sound && g.audio === "generated" ? { audio: "original" as const } : {};
    const from = clipOf(g);
    const slot = m.clip === "h3" ? g.h3Source : m.clip === "wan" ? g.wanSource : undefined;
    const same = (a?: Asset, b?: Asset) => !!a?.source && !!b?.source && a.source.url === b.source.url && Math.abs(a.source.start - b.source.start) < 0.05;
    // Same kind of clip, or nothing to cut from: just switch.
    if (m.clip === current.clip || m.clip === "image" || !from?.source) return g.set({ models, ...sound });
    // The box track moves with the clip: same moments, at the new frame rate.
    const keys = (to: Asset) => (g.mode === "replace" ? { keys: retime(useG.getState().keys, from, to) } : {});
    // Already cut for it.
    if (slot && same(from, slot)) return g.set({ models, ...sound, ...keys(slot) });
    setCutting(m.key);
    try {
      const clip = await api.trim(from, m.clip, from.source.start);
      useG
        .getState()
        .set({ models, ...sound, ...(m.clip === "h3" ? { h3Source: clip } : { wanSource: clip }), ...clearedBy({ models }, m.clip), ...keys(clip) });
    } catch (e) {
      fail(e);
    } finally {
      setCutting(null);
    }
  };

  function builtIn(m: HenshinModelInfo): Choice {
    return { key: m.id as Choice["key"], name: m.name, blurb: tr(m.blurb), clip: m.clip, sound: m.sound, ready: !caps || henshinReady(g.mode, m.id, caps) };
  }

  const all = choices.flatMap((c) => c.items);
  const picked = all.find((m) => m.key === chosen);
  const recipe = chosen.startsWith("wf:") ? chosen.slice(3) : null;
  // Video workflows that can't take what this mode gives: shown, greyed out, so it's clear why.
  const unfit = recipes.filter((r) => isEngine(r) && r.output === "video" && !workflowFits(r, g.mode));

  return (
    <Section title={tr("Model")} aside={<EngineSource paid={recipe ? recipes.find((r) => r.id === recipe)?.paid : undefined} />}>
      <select
        value={chosen}
        disabled={!!cutting}
        onChange={(e) => {
          const m = all.find((x) => x.key === e.target.value);
          if (m) void choose(m);
        }}
        className="rounded-md bg-surround px-2.5 py-2 text-[14px] focus:outline-none disabled:opacity-60"
        aria-label={tr("Model")}
      >
        {choices.map((group) =>
          group.items.length ? (
            <optgroup key={group.title} label={tr(group.title)}>
              {group.items.map((m) => (
                <option key={m.key} value={m.key}>
                  {[m.name, m.ready ? m.tag : tr("Not installed")].filter(Boolean).join(" · ")}
                </option>
              ))}
            </optgroup>
          ) : null,
        )}
        {unfit.length > 0 && (
          <optgroup label={tr(WORKFLOW_NEEDS[g.mode])}>
            {unfit.map((r) => (
              <option key={r.id} value={`unfit:${r.id}`} disabled>
                {r.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {cutting && <p className="text-[12px] text-dim">{tr("Cutting the clip for it…")}</p>}
      {picked?.blurb && <p className="text-[12px] leading-snug text-dim">{picked.blurb}</p>}
      {caps && current.id !== "workflow" && !henshinReady(g.mode, current.id, caps) && (
        <Locked>
          {/* File names are long and unbroken: let them wrap anywhere. */}
          <span className="[overflow-wrap:anywhere]">
            {tr("{model} is not installed on the server. It needs: {files}.", { model: current.name, files: current.files.join(", ") })}
          </span>
        </Locked>
      )}
      {recipe && (
        <>
          <p className="text-[12px] text-dim">{tr(WORKFLOW_NOTE[g.mode])}</p>
          {/* The chosen workflow is changed where workflows live; Henshin runs what's saved there. */}
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            <Link href={`/workflows?open=${encodeURIComponent(recipe)}&mode=graph`} className="flex items-center gap-1 text-dim hover:text-ink">
              <Workflow size={12} />
              {tr("Edit graph")}
            </Link>
            <Link href={`/workflows?open=${encodeURIComponent(recipe)}&mode=customise`} className="flex items-center gap-1 text-dim hover:text-ink">
              <SlidersHorizontal size={12} />
              {tr("Edit form")}
            </Link>
          </span>
        </>
      )}
      {workflows.length ? (
        <Link href="/workflows" className="self-start text-[12px] text-dim underline hover:text-ink">
          {tr("Import or manage workflows")}
        </Link>
      ) : (
        <p className="text-[12px] text-faint">
          {tr("Workflows you import that take a clip (and a picture, for Recast; a still, for motion paths) show up here too.")}{" "}
          <Link href="/workflows" className="text-dim underline hover:text-ink">
            {tr("Import a workflow")}
          </Link>
        </p>
      )}
    </Section>
  );
}

/** Why the other video workflows can't run a mode: what it needs that they don't take. */
const WORKFLOW_NEEDS: Record<Mode, string> = {
  recast: "Can't recast: needs a clip and a picture input",
  restyle: "Can't restyle: needs a clip input",
  replace: "Can't replace: needs a clip input",
  paths: "Can't animate: needs a picture input",
};

/** One entry in the model list: a built-in model, or an imported workflow ("wf:<id>"). */
interface Choice {
  key: NonNullable<G["models"][Mode]>;
  name: string;
  blurb: string;
  clip: "h3" | "wan" | "image";
  sound: boolean;
  ready: boolean;
  /** Where it runs (Local, Cloud GPU, API), for workflows. */
  tag?: string;
}

/** What a workflow gets from each mode. */
const WORKFLOW_NOTE: Record<Mode, string> = {
  recast: "Your workflow gets the clip, your character's picture (and the extras), and what to do in its prompt.",
  restyle: "Your workflow gets the clip, the style picture if there is one, and the style in its prompt.",
  replace: "Your workflow gets the clip, the picture if there is one, and the change in its prompt, with where the box is in words.",
  paths: "Your workflow gets the still and the motion in its prompt, with the paths in words.",
};

/** Box keyframes from one cut of a clip to another of the same original: same moments, new frame numbers. */
export function retime(keys: BoxKey[], from: Asset, to: Asset): BoxKey[] {
  const shift = (from.source?.start ?? 0) - (to.source?.start ?? 0);
  const last = (to.frames ?? 1) - 1;
  const out = new Map<number, BoxKey>();
  for (const k of keys) {
    const f = Math.round(((k.f + 0.5) / (from.fps ?? 16) + shift) * (to.fps ?? 24) - 0.5) || 0; // never -0
    if (f >= 0 && f <= last) out.set(f, { ...k, f });
  }
  return [...out.values()].sort((a, b) => a.f - b.f);
}

function ModeSettings({ caps }: { caps?: Capabilities }) {
  const g = useG();
  const model = modelOf(g);
  // A workflow makes what sound it makes; ours can't be added to it.
  const audio = model.id !== "workflow" && (
    <Section title={tr("Sound")}>
      <Segmented
        label={tr("Sound")}
        size="sm"
        value={g.audio}
        onChange={(audio) => g.set({ audio })}
        options={[
          { id: "original", label: "Keep original" },
          // Only H3 makes sound of its own.
          ...(model.sound ? [{ id: "generated" as const, label: "New" }] : []),
          { id: "none", label: "Silent" },
        ]}
      />
    </Section>
  );
  const quality = model.quality && (
    <Section title={tr("Quality")}>
      <Segmented<Quality>
        label={tr("Quality")}
        size="sm"
        value={g.quality}
        onChange={(quality) => g.set({ quality })}
        options={[
          { id: "draft", label: "Draft 480p" },
          { id: "studio", label: "Studio 720p" },
        ]}
      />
    </Section>
  );

  if (g.mode === "recast")
    return (
      <>
        <Section title={tr("Your character")}>
          <div className="grid grid-cols-3 gap-2">
            <AssetSlot asset={g.character} label={tr("Lead")} onSet={(character) => g.set({ character })} tall />
            {g.extras.map((x, i) => (
              <AssetSlot key={x.name} asset={x} label={`Extra ${i + 1}`} onSet={(a) => g.set({ extras: a ? g.extras.map((e, j) => (j === i ? a : e)) : g.extras.filter((_, j) => j !== i) })} tall />
            ))}
            {g.extras.length < 3 && <AssetSlot label={tr("Extra")} onSet={(a) => a && g.set({ extras: [...g.extras, a] })} tall />}
          </div>
          <p className="text-[12px] text-faint">{tr("A clear, front-facing full-body image works best. Extras are for other people or props in the clip.")}</p>
        </Section>
        <Section title={tr("Direction")} aside={tr("Optional")}>
          <textarea
            value={g.notes}
            onChange={(e) => g.set({ notes: e.target.value })}
            rows={3}
            placeholder={tr("e.g. keep the red umbrella, make it night")}
            className="w-full rounded-md bg-surround px-3 py-2 text-[14px] placeholder:text-faint focus:outline-none"
          />
        </Section>
        {audio}
        {quality}
      </>
    );

  if (g.mode === "restyle")
    return (
      <>
        <Section title={tr("New style")}>
          {/* A starting point: fills in the words and the film stock that suits them; both stay editable. */}
          <div className="flex flex-wrap gap-1.5">
            {RESTYLES.map((r) => (
              <button
                key={r.id}
                onClick={() => g.set({ style: r.prompt, look: caps?.pack.lensFilm ? r.look : g.look })}
                aria-pressed={g.style === r.prompt}
                title={r.prompt}
                className={clsx(
                  "rounded-full px-2.5 py-1 text-[12px] transition-colors",
                  g.style === r.prompt ? "bg-ink text-surround" : "bg-surround text-dim hover:text-ink",
                )}
              >
                {tr(r.label)}
              </button>
            ))}
          </div>
          <textarea
            value={g.style}
            onChange={(e) => g.set({ style: e.target.value })}
            rows={3}
            placeholder={tr("e.g. stop-motion claymation with felt textures, or 1970s hand-painted anime cel")}
            className="w-full rounded-md bg-surround px-3 py-2 text-[14px] placeholder:text-faint focus:outline-none"
          />
          <div className="grid grid-cols-3 gap-2">
            <AssetSlot asset={g.styleRef} label={tr("Style image")} onSet={(styleRef) => g.set({ styleRef })} />
          </div>
        </Section>
        {model.id !== "workflow" && (
          <Section title={tr("Film stock")} aside={caps?.pack.lensFilm ? "Graded on the GPU" : "Needs NovaField nodes"}>
            {caps?.pack.lensFilm ? (
              <div className="grid grid-cols-3 gap-1.5">
                {LOOKS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => g.set({ look: l.id })}
                    aria-pressed={g.look === l.id}
                    className={clsx(
                      "flex flex-col gap-1 rounded-[5px] p-1 text-left",
                      g.look === l.id ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)]",
                    )}
                  >
                    <span className="flex h-4 overflow-hidden rounded-[3px]">
                      {l.swatch.map((c) => (
                        <span key={c} className="flex-1" style={{ background: c }} />
                      ))}
                    </span>
                    <span className="truncate text-[12px] text-dim">{l.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <NodesCallout feature={tr("Grading restyled clips with film stocks")} />
            )}
          </Section>
        )}
        {audio}
        {quality}
      </>
    );

  if (g.mode === "replace")
    return (
      <>
        {!caps?.pack.boxTrack && <NodesCallout feature={tr("Replace (it tracks your box on the GPU)")} />}
        <Section title={tr("Box shape")}>
          <Segmented
            label={tr("Box shape")}
            size="sm"
            value={g.shape}
            onChange={(shape) => g.set({ shape })}
            options={[
              { id: "ellipse", label: "Ellipse" },
              { id: "rect", label: "Rectangle" },
            ]}
          />
        </Section>
        <Section title={tr("It becomes")}>
          <textarea
            value={g.replacePrompt}
            onChange={(e) => g.set({ replacePrompt: e.target.value })}
            rows={3}
            placeholder={tr("e.g. a golden retriever sitting calmly")}
            className="w-full rounded-md bg-surround px-3 py-2 text-[14px] placeholder:text-faint focus:outline-none"
          />
          <div className="grid grid-cols-3 gap-2">
            <AssetSlot asset={g.replacement} label={tr("Reference")} onSet={(replacement) => g.set({ replacement })} />
          </div>
          <p className="text-[12px] text-faint">{tr("Everything outside the box is kept.")}</p>
        </Section>
        {quality}
      </>
    );

  return (
    <>
      <Section title={tr("What moves")}>
        <textarea
          value={g.pathPrompt}
          onChange={(e) => g.set({ pathPrompt: e.target.value })}
          rows={3}
          placeholder={tr("e.g. the paper boat drifts down the stream as leaves fall")}
          className="w-full rounded-md bg-surround px-3 py-2 text-[14px] placeholder:text-faint focus:outline-none"
        />
      </Section>
      <Section title={tr("How it works")}>
        <p className="text-[12px] leading-relaxed text-dim">
          {tr("Each path you draw becomes a motion track: the point under the start of the stroke follows it, across the whole 5 seconds or the span you set for that path. Pin points to keep things still; the frame presets move everything, like a camera.")}
        </p>
      </Section>
    </>
  );
}

export function AssetSlot({ asset, label, onSet, tall }: { asset?: Asset; label: string; onSet: (a: Asset | undefined) => void; tall?: boolean }) {
  const shape = tall ? "aspect-[3/4]" : "aspect-square";
  return (
    <div className="flex flex-col gap-1">
      {asset ? (
        <div className={clsx("group relative overflow-hidden rounded-[5px] bg-surround", shape)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.url} alt={label} className="size-full object-cover" />
          <button
            onClick={() => onSet(undefined)}
            className="absolute top-1 right-1 rounded bg-black/65 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            aria-label={tr("Remove {name}", { name: label })}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <Drop purpose="image" accept="image/*" onAsset={onSet}>
          {({ over }) => (
            <div
              className={clsx(
                "flex flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed text-[12px] transition-colors",
                shape,
                over ? "border-tungsten text-ink" : "border-line text-faint hover:border-dim hover:text-dim",
              )}
            >
              <ImagePlus size={16} />
              {tr("Add")}
            </div>
          )}
        </Drop>
      )}
      <span className="text-[12px] text-dim">{label}</span>
    </div>
  );
}

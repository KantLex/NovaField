"use client";

// The Image page's tools: edit from words, upscale, widen the frame. Each run makes new versions
// of the picture on show; the picture itself is never changed.

import clsx from "clsx";
import { ChevronDown, Dices, Play, Workflow } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { editModel, imageBlocker, MODEL_LABEL, upscaleSize } from "@/lib/engines/image";
import { ASPECTS } from "@/lib/engines/sizing";
import type { Asset, ImageSpec, ImageTool } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { blockingMissing } from "@/lib/workflows/missing";
import { api, fail, toast } from "../api";
import { Button, Section, Segmented, Slider } from "../controls";
import { Menu, MenuItem } from "../Menu";
import { sendPicture } from "../sendTo";
import { caps as currentCaps, randomSeed, useLive } from "../state";
import { useForms, useRecipes } from "../workflows/store";
import { EDIT_PRESETS, LAB_ASPECTS, moreLikeThis, pictureOf, respin, sceneOf, useLab } from "./state";
import { tr } from "@/i18n";

const TOOLS: { id: ImageTool; label: string; verb: string; blurb: string }[] = [
  { id: "edit", label: "Edit", verb: "Edit", blurb: "Say what to change: the light, the weather, a colour, an object to add or remove." },
  { id: "upscale", label: "Upscale", verb: "Upscale", blurb: "Twice the size, with new fine detail drawn in rather than stretched pixels." },
  { id: "expand", label: "Expand", verb: "Expand", blurb: "Widen the frame to a new shape. The model paints what lies beyond the edges." },
];

export function ToolPanel({ job, asset, size }: { job: Job | null; asset: Asset | null; size: { width: number; height: number } | null }) {
  const lab = useLab();
  const router = useRouter();
  const status = useLive((s) => s.status);
  const setFocus = useLive((s) => s.setFocus);
  const recipes = useRecipes((s) => s.list);
  const [busy, setBusy] = useState(false);
  const caps = status?.caps ?? currentCaps();
  const tool = TOOLS.find((t) => t.id === lab.tool)!;
  // A picture to work on: a finished picture take, or an upload.
  const ready = job ? job.status === "done" && !!job.image : !!asset;
  const source: Asset | null = asset && !job ? asset : size ? { name: "", kind: "image", url: "", width: size.width, height: size.height } : null;
  const bothModels = caps.image.qwen && caps.image.kontext;
  const model = editModel({ model: lab.model }, caps);

  const draft: ImageSpec | null = source
    ? {
        kind: "image",
        tool: lab.tool,
        image: source,
        prompt: lab.tool === "edit" ? lab.edit : lab.tool === "upscale" ? lab.detail : lab.fill,
        model: lab.model,
        scale: lab.scale,
        creativity: lab.creativity,
        aspect: lab.aspect,
        seed: 0,
      }
    : null;
  const blocker = !status ? null : draft ? imageBlocker(draft, caps) : null;
  const out = draft && lab.tool === "upscale" ? upscaleSize(draft.image, lab.scale) : null;

  // Ctrl+Enter reaches run() without the button, so it checks what the button's disabled state does.
  const runningNow = useRef(false);
  const run = async () => {
    if (!draft || blocker || !ready || !status || runningNow.current) return;
    runningNow.current = true;
    setBusy(true);
    try {
      const image = job ? await pictureOf(job) : asset!;
      // The upscale is guided by what the picture shows: the take's own prompt unless one was typed.
      const prompt = lab.tool === "upscale" && !draft.prompt.trim() && job ? sceneOf(job, useLive.getState().jobs) : draft.prompt;
      const spec: ImageSpec = { ...draft, image, prompt, from: job?.id, model: lab.tool === "upscale" ? undefined : (model ?? undefined) };
      const made = await api.submit(Array.from({ length: lab.count }, () => ({ ...spec, seed: randomSeed() })));
      setFocus(made[0].id);
      toast(tr("{action} sent to the GPU.", { action: tr(tool.verb) }));
    } catch (e) {
      fail(e);
    } finally {
      runningNow.current = false;
      setBusy(false);
    }
  };

  // Imported workflows with a picture input (an upscaler, an image-to-video model…).
  const takers = recipes.filter((r) => !blockingMissing(r.missing).length && r.fields.some((f) => f.role === "image"));
  const intoWorkflow = async (id: string) => {
    const recipe = takers.find((r) => r.id === id);
    const field = recipe?.fields.find((f) => f.role === "image");
    if (!recipe || !field) return;
    try {
      // Workflow forms take the file as it is, by its name in the input folder.
      const raw = job ? await api.useTake(job.id, "raw") : asset!;
      useForms.getState().remember(raw.name, raw.url);
      useForms.getState().set(recipe.id, field.id, raw.name);
      toast(tr("The picture is in “{name}”. Fill in the rest, then run it.", { name: recipe.name }), "done");
      router.push(`/workflows?open=${encodeURIComponent(recipe.id)}`);
    } catch (e) {
      fail(e);
    }
  };
  const canRespin = !!job && job.status === "done" && !!respin(job.spec, recipes);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Segmented label="Image tool" value={lab.tool} onChange={(t) => lab.set({ tool: t })} options={TOOLS.map((t) => ({ id: t.id, label: t.label }))} />
        <p className="text-[13px] text-dim">{tr(tool.blurb)}</p>
      </div>

      {lab.tool === "edit" && (
        <Section title={tr("The change")}>
          <textarea
            value={lab.edit}
            onChange={(e) => lab.set({ edit: e.target.value })}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.repeat && void run()}
            rows={4}
            placeholder={tr("Make it night. Give her a red raincoat. Remove the car on the left.")}
            aria-label={tr("What should change")}
            className="w-full resize-y rounded-md bg-surround px-3 py-2 text-[14px] leading-relaxed placeholder:text-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-ink/40"
          />
          <div className="flex flex-wrap gap-1.5">
            {EDIT_PRESETS.map((p) => (
              <button
                key={p.label}
                // The words stay in English: Flux Kontext only reads English, and Qwen reads both.
                onClick={() => lab.set({ edit: p.prompt })}
                title={p.prompt}
                className={clsx("rounded-full px-2.5 py-1 text-[12px] transition-colors", lab.edit === p.prompt ? "bg-tungsten text-black" : "bg-raised text-dim hover:bg-hover hover:text-ink")}
              >
                {tr(p.label)}
              </button>
            ))}
          </div>
        </Section>
      )}

      {lab.tool === "upscale" && (
        <Section title={tr("Upscale")} aside={out && out.factor >= 1.1 ? `${out.width}×${out.height}` : undefined}>
          <Segmented
            label="How much bigger"
            size="sm"
            value={lab.scale}
            onChange={(scale) => lab.set({ scale })}
            options={[
              { id: 1.5, label: "×1.5" },
              { id: 2, label: "×2" },
            ]}
          />
          <Slider label="Creativity" value={lab.creativity} min={0} max={1} step={0.05} onChange={(creativity) => lab.set({ creativity })} format={(v) => `${Math.round(v * 100)}%`} />
          <p className="-mt-1 text-[12px] text-faint">{tr("Low keeps the picture as it is; high draws in more new detail (skin, fabric, leaves) and may change small things.")}</p>
          <textarea
            value={lab.detail}
            onChange={(e) => lab.set({ detail: e.target.value })}
            rows={2}
            placeholder={job && sceneOf(job, useLive.getState().jobs) ? tr("Uses the picture's own prompt. Type to describe it differently.") : tr("What the picture shows (optional): helps the new detail fit.")}
            aria-label={tr("What the picture shows")}
            className="w-full resize-y rounded-md bg-surround px-3 py-2 text-[13px] leading-relaxed placeholder:text-faint focus:outline-none"
          />
        </Section>
      )}

      {lab.tool === "expand" && (
        <Section title={tr("New frame")}>
          <Segmented label="Frame" size="sm" value={lab.aspect} onChange={(aspect) => lab.set({ aspect })} options={LAB_ASPECTS.map((a) => ({ id: a, label: ASPECTS.find((x) => x.id === a)?.label ?? a }))} />
          <textarea
            value={lab.fill}
            onChange={(e) => lab.set({ fill: e.target.value })}
            rows={2}
            placeholder={tr("What fills the new space (optional): more of the street, a crowd, open sky…")}
            aria-label={tr("What fills the new space")}
            className="w-full resize-y rounded-md bg-surround px-3 py-2 text-[13px] leading-relaxed placeholder:text-faint focus:outline-none"
          />
        </Section>
      )}

      {lab.tool !== "upscale" && bothModels && (
        <Section title={tr("Model")}>
          <Segmented
            label="Editing model"
            size="sm"
            value={model ?? "qwen"}
            onChange={(m) => lab.set({ model: m })}
            options={[
              { id: "qwen" as const, label: MODEL_LABEL.qwen, title: "Best at precise changes and at text in the picture." },
              { id: "kontext" as const, label: MODEL_LABEL.kontext, title: "Strong at keeping faces and style while restyling." },
            ]}
          />
        </Section>
      )}

      <Section title={tr("Versions")}>
        <Segmented
          label="Versions per run"
          size="sm"
          value={lab.count}
          onChange={(count) => lab.set({ count })}
          options={[1, 2, 4].map((n) => ({ id: n, label: String(n) }))}
        />
        <p className="-mt-1 text-[12px] text-faint">{tr("Each version gets its own seed, so you can keep the best one.")}</p>
      </Section>

      <div className="mt-auto flex flex-col gap-2 border-t border-line/60 pt-4">
        <Button variant="solid" className="py-2.5 text-[15px]" disabled={!ready || busy || !!blocker || !status} onClick={run}>
          {lab.count > 1 ? tr("{action} ×{n}", { action: tr(tool.verb), n: lab.count }) : tr(tool.verb)}
        </Button>
        <p className="text-[12px] text-dim">
          {!job && !asset ? (
            tr("Pick a picture first.")
          ) : !ready ? (
            tr("Pick a finished picture.")
          ) : lab.tool === "edit" && !lab.edit.trim() ? (
            tr("Say what to change, or pick a ready-made change.")
          ) : blocker ? (
            <span className="text-tally">{tr(blocker)}</span>
          ) : (
            <span className="text-ink/80">{lab.tool === "upscale" ? "Z Image Turbo" : model ? MODEL_LABEL[model] : ""}</span>
          )}
        </p>
        {ready && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {canRespin && (
              <Button onClick={() => job && void moreLikeThis(job, lab.count, recipes)} title={tr("Run the same job again with a new seed")}>
                <Dices size={14} />
                {tr("More like this")}
              </Button>
            )}
            <Button
              onClick={async () => {
                try {
                  sendPicture(job ? await pictureOf(job) : asset!, "first", router.push);
                } catch (e) {
                  fail(e);
                }
              }}
              title={tr("Animate this picture")}
            >
              <Play size={14} />
              {tr("Animate")}
            </Button>
            {takers.length > 0 && (
              <Menu
                label={tr("Run through a workflow")}
                trigger={(open) => (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] text-ink hover:bg-hover">
                    <Workflow size={14} />
                    {tr("Workflow")}
                    <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
                  </span>
                )}
              >
                {(close) =>
                  takers.map((r) => (
                    <MenuItem
                      key={r.id}
                      onClick={() => {
                        close();
                        void intoWorkflow(r.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{r.name}</span>
                      <span className="text-[11px] text-faint">{tr(r.output === "video" ? "Video" : r.output === "image" ? "Image" : "Workflow")}</span>
                    </MenuItem>
                  ))
                }
              </Menu>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

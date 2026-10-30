"use client";

// Henshin's side panel: each mode's settings and the asset slots it fills.

import clsx from "clsx";
import { ImagePlus, X } from "lucide-react";
import { LOOKS } from "@/lib/cinema/looks";
import type { Asset, Quality } from "@/lib/engines/specs";
import { Locked, Section, Segmented } from "@/ui/controls";
import { Drop } from "@/ui/Drop";
import { NodesCallout } from "@/ui/NodesCallout";
import { tr } from "@/i18n";
import { useG } from "@/ui/henshin/state";

export function ModePanel({ caps }: { caps?: { pack: { boxTrack: boolean; lensFilm: boolean }; vace: boolean; wanMove: boolean; h3Ref: boolean } }) {
  const g = useG();
  const audio = (
    <Section title={tr("Sound")}>
      <Segmented
        label={tr("Sound")}
        size="sm"
        value={g.audio}
        onChange={(audio) => g.set({ audio })}
        options={[
          { id: "original", label: "Keep original" },
          { id: "generated", label: "New" },
          { id: "none", label: "Silent" },
        ]}
      />
    </Section>
  );
  const quality = (
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
          <p className="text-[12px] text-faint">{tr("Runs on Wan 2.1 VACE at 16 fps. Everything outside the box is kept.")}</p>
        </Section>
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
          {tr("Each path you draw becomes a WanMove track: the point under the start of the stroke follows it, across the whole 5 seconds or the span you set for that path. Pin points to keep things still; the frame presets move everything, like a camera.")}
        </p>
      </Section>
      {caps && !caps.wanMove && <Locked>{tr("WanMove and Wan 2.1 image-to-video are not installed on the server.")}</Locked>}
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

"use client";

import clsx from "clsx";
import { AnimatePresence } from "motion/react";
import { ImagePlus, Library, X } from "lucide-react";
import { useState } from "react";
import type { Asset } from "@/lib/engines/specs";
import { AssetPicker } from "../assets/AssetPicker";
import { SaveToAssets } from "../assets/SaveToAssets";
import { Drop } from "../Drop";
import { Section } from "../controls";
import { useStudio } from "../state";
import { tr } from "@/i18n";

export function CastShelf() {
  const shot = useStudio((s) => s.shot);
  const { patch, addCast, updateCast, removeCast } = useStudio.getState();
  const [picking, setPicking] = useState(false);
  // Pictures of one asset share its name: rename them together, and remove them together if asked.
  const renameAt = (i: number, label: string) => {
    const g = shot.cast[i].group;
    if (!g) return updateCast(i, { label });
    patch({ cast: shot.cast.map((c) => (c.group === g ? { ...c, label } : c)) });
  };

  return (
    <div className="flex flex-col gap-6">
      <Section title={tr("Cast")} aside={`${shot.cast.length}/9`}>
        <p className="-mt-1 text-[12px] text-faint">{tr("People, props and places to keep consistent. Mention them in the script with @name.")}</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-3">
          {shot.cast.map((c, i) => (
            <figure key={c.name + i} className="group relative flex animate-[nf-pop_0.22s_ease-out] flex-col gap-1">
              <div className="relative aspect-[3/4] overflow-hidden rounded-[5px] bg-surround">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.url && <img src={c.url} alt={c.label ?? `Cast ${i + 1}`} className="size-full object-cover" />}
                <span className="readout absolute top-1 left-1 rounded bg-black/65 px-1 text-[12px]">{i + 1}</span>
                <button
                  onClick={() => removeCast(i)}
                  className="absolute top-1 right-1 rounded bg-black/65 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  aria-label={tr("Remove {name}", { name: c.label ?? String(i + 1) })}
                >
                  <X size={13} />
                </button>
                {c.group ? (
                  // From the asset library: a small mark so it's clear these pictures travel together.
                  <span className="absolute right-1 bottom-1 rounded bg-black/65 p-0.5 text-tungsten" title={tr("From your assets")}>
                    <Library size={11} />
                  </span>
                ) : (
                  <span className="absolute right-0.5 bottom-0.5 rounded bg-black/65 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <SaveToAssets choices={[{ url: c.url, label: tr("This picture") }]} suggestedName={c.label} compact />
                  </span>
                )}
              </div>
              <input
                value={c.label ?? ""}
                placeholder={`name`}
                onChange={(e) => renameAt(i, e.target.value.replace(/\s+/g, "").slice(0, 16))}
                className="w-full rounded bg-transparent px-1 text-[12px] text-tungsten placeholder:text-faint focus:bg-surround focus:outline-none"
                aria-label={tr("Name for cast {n}", { n: i + 1 })}
              />
            </figure>
          ))}
          {shot.cast.length < 9 && (
            <button
              onClick={() => setPicking(true)}
              className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed border-tungsten/40 text-[12px] text-tungsten/80 transition-colors hover:border-tungsten hover:text-tungsten"
              title={tr("Bring in a character, object or place from your assets: all its pictures at once")}
            >
              <Library size={18} />
              {tr("Assets")}
            </button>
          )}
          {shot.cast.length < 9 && (
            <Drop purpose="image" accept="image/*" multiple assets={false} onAsset={(a) => addCast({ ...a, label: a.label?.replace(/\s+/g, "").slice(0, 16) })}>
              {({ over }) => (
                <div
                  className={clsx(
                    "flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-[5px] border border-dashed text-[12px] transition-colors",
                    over ? "border-tungsten text-ink" : "border-line text-faint hover:border-dim hover:text-dim",
                  )}
                >
                  <ImagePlus size={18} />
                  {tr("Add")}
                </div>
              )}
            </Drop>
          )}
        </div>
      </Section>

      <AnimatePresence>
        {picking && (
          <AssetPicker
            media={["image"]}
            purpose="image"
            mode="group"
            room={9 - shot.cast.length}
            onPick={(list) => {
              // Picking an asset that's already cast refreshes it instead of doubling it up.
              const groups = new Set(list.map((a) => a.group));
              const kept = useStudio.getState().shot.cast.filter((c) => !c.group || !groups.has(c.group));
              patch({ cast: [...kept, ...list].slice(0, 9) });
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>

      <Section title={tr("Frames")}>
        <div className="grid max-w-[420px] grid-cols-2 gap-2 xl:max-w-none">
          <FrameSlot label={tr("First frame")} asset={shot.startFrame} onSet={(a) => patch({ startFrame: a })} />
          <FrameSlot label={tr("Last frame")} asset={shot.endFrame} onSet={(a) => patch({ endFrame: a })} />
        </div>
      </Section>
    </div>
  );
}

function FrameSlot({ label, asset, onSet }: { label: string; asset?: Asset; onSet: (a: Asset | undefined) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {asset ? (
        // Still a drop target, so another picture or a take dragged from the strip replaces it.
        <Drop purpose="image" accept="image/*" assets={false} onAsset={(a) => onSet(a)} className="rounded-[5px]">
          {() => (
            <div className="group relative aspect-video overflow-hidden rounded-[5px] bg-surround">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={label} className="size-full object-cover" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSet(undefined);
                }}
                className="absolute top-1 right-1 rounded bg-black/65 p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                aria-label={tr("Clear {name}", { name: tr(label) })}
              >
                <X size={13} />
              </button>
            </div>
          )}
        </Drop>
      ) : (
        <Drop purpose="image" accept="image/*" onAsset={(a) => onSet(a)}>
          {({ over }) => (
            <div
              className={clsx(
                "flex aspect-video items-center justify-center rounded-[5px] border border-dashed text-[12px] transition-colors",
                over ? "border-tungsten text-ink" : "border-line text-faint hover:border-dim hover:text-dim",
              )}
            >
              {tr("Drop image")}
            </div>
          )}
        </Drop>
      )}
      <span className="text-[12px] text-dim">{label}</span>
    </div>
  );
}

"use client";

import clsx from "clsx";
import { ImagePlus, Library, LoaderCircle, Plus, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { ASSET_KINDS, countLabel, coverOf, handleOf, type AssetEntry, type AssetKind } from "@/lib/assets";
import { ensureAssets, useAssets } from "@/ui/assets/store";
import { columnWidth, SidePanel, usePanelKeys, usePanelOpen } from "@/ui/SidePanel";
import { tr } from "@/i18n";
import { useReveal } from "@/ui/reveal";
import { Editor } from "@/ui/assets/AssetEditor";
import { CreateForm } from "@/ui/assets/AssetForm";

export default function AssetsPage() {
  const list = useAssets((s) => s.list);
  const loaded = useAssets((s) => s.loaded);
  const [kind, setKind] = useState<AssetKind | "all">("all");
  const reveal = useReveal(kind);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<AssetKind | null>(null);
  useEffect(() => ensureAssets(), []);

  const needle = q.trim().toLowerCase();
  const shown = list.filter((e) => (kind === "all" || e.kind === kind) && (!needle || `${e.name} ${e.description}`.toLowerCase().includes(needle)));
  const current = open ? list.find((e) => e.id === open) : null;
  const panelOpen = usePanelOpen("assets-panel");
  usePanelKeys({ right: "assets-panel" });

  return (
    <div className="mx-auto grid w-full max-w-[1560px] grid-cols-[minmax(0,1fr)] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_var(--nf-right)]" style={{ "--nf-right": columnWidth(panelOpen, "420px") } as React.CSSProperties}>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="display text-[30px] leading-tight">{tr("Assets")}</h1>
            <p className="max-w-[64ch] text-[13px] text-dim">
              {tr("Register characters, objects, places, styles and clips once. Bring a whole character into a shot with one click, mention it as @name, or drop any of its files into Studio, Henshin and your workflows.")}
            </p>
          </div>
          <NewAsset onNew={(k) => (setCreating(k), setOpen(null))} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={tr("Asset types")}>
            {[{ id: "all" as const, plural: "All" }, ...ASSET_KINDS].map((k) => {
              const n = k.id === "all" ? list.length : list.filter((e) => e.kind === k.id).length;
              return (
                <button
                  key={k.id}
                  role="tab"
                  aria-selected={kind === k.id}
                  onClick={() => setKind(k.id)}
                  className={clsx("flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px]", kind === k.id ? "bg-tungsten text-black" : "bg-panel text-dim hover:text-ink")}
                >
                  {tr(k.plural)}
                  <span className={clsx("readout text-[12px]", kind === k.id ? "text-black/60" : "text-faint")}>{n}</span>
                </button>
              );
            })}
          </div>
          <label className="ml-auto flex h-8 w-full items-center gap-2 rounded-md bg-panel px-2.5 sm:w-[240px]">
            <Search size={14} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search names and descriptions")} className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none" />
          </label>
        </div>

        {loaded && list.length === 0 && !creating && <Empty onNew={setCreating} />}

        <div key={reveal.key} className={clsx("grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3 gap-y-4", reveal.className)}>
          {shown.map((e) => (
            <Card key={e.id} entry={e} active={open === e.id} onOpen={() => (setOpen(e.id), setCreating(null))} />
          ))}
        </div>
        {!loaded && (
          <p className="flex items-center gap-2 text-[13px] text-dim">
            <LoaderCircle size={14} className="animate-spin" /> {tr("Loading…")}
          </p>
        )}
      </div>

      <SidePanel
        id="assets-panel"
        side="right"
        label="Asset"
        className="lg:sticky lg:top-[69px] lg:max-h-[calc(100dvh_-_90px)] lg:self-start"
        bodyClassName="flex flex-col gap-4 lg:overflow-y-auto"
      >
        {/* One panel that swaps its content in place. Cross-fading two panels of different heights
            made the box look like it changed shape on every switch. */}
        {creating ? (
          <div key="new" className="animate-[nf-fade_0.15s_ease-out]">
            <CreateForm
              kind={creating}
              onKind={setCreating}
              onDone={(id) => {
                setCreating(null);
                setOpen(id);
              }}
              onCancel={() => setCreating(null)}
            />
          </div>
        ) : current ? (
          <div key="editor" className="animate-[nf-fade_0.15s_ease-out]">
            <Editor key={current.id} entry={current} onClose={() => setOpen(null)} />
          </div>
        ) : (
          list.length > 0 && (
            <div key="hint" className="hidden rounded-md bg-panel p-5 text-[13px] text-dim lg:block">
              {tr("Select an asset to edit it, add more pictures, or put it in the Studio cast.")}
            </div>
          )
        )}
      </SidePanel>
    </div>
  );
}

function NewAsset({ onNew }: { onNew: (k: AssetKind) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ASSET_KINDS.map((k, i) => (
        <button
          key={k.id}
          onClick={() => onNew(k.id)}
          title={tr(k.hint)}
          className={clsx(
            "flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px]",
            i === 0 ? "bg-tungsten font-semibold text-black hover:bg-[#efff6b]" : "bg-raised text-ink hover:bg-hover",
          )}
        >
          <Plus size={14} /> {tr(k.label)}
        </button>
      ))}
    </div>
  );
}

function Empty({ onNew }: { onNew: (k: AssetKind) => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-md bg-panel p-8">
      <Library className="text-tungsten" />
      <p className="max-w-[60ch] text-[15px]">
        {tr("Start with a character: give it a name, drop in a few pictures (front, side, close-up) and describe what the pictures can't say.")}
      </p>
      <button onClick={() => onNew("character")} className="rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
        {tr("New character")}
      </button>
    </div>
  );
}

function Card({ entry, active, onOpen }: { entry: AssetEntry; active: boolean; onOpen: () => void }) {
  const cover = coverOf(entry);
  const kind = ASSET_KINDS.find((k) => k.id === entry.kind);
  const thumbs = entry.items.filter((i) => i.poster && i.id !== cover?.id).slice(0, 3);
  return (
    <button data-asset={entry.id} onClick={onOpen} className="group flex flex-col gap-1.5 text-left">
      <span
        className={clsx(
          "relative block aspect-[4/5] w-full overflow-hidden rounded-[5px] bg-panel transition-shadow",
          active ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)] group-hover:shadow-[0_0_0_1px_var(--color-dim)]",
        )}
      >
        {cover?.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.poster} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="flex size-full items-center justify-center text-faint">
            <ImagePlus size={22} />
          </span>
        )}
        <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-ink/90">{tr(kind?.label ?? "")}</span>
        {entry.favorite && <Star size={13} className="absolute top-1.5 right-1.5 fill-tungsten text-tungsten" />}
        {thumbs.length > 0 && (
          <span className="absolute right-1.5 bottom-1.5 flex gap-1">
            {thumbs.map((t) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={t.id} src={t.poster} alt="" className="size-7 rounded-[3px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
            ))}
          </span>
        )}
      </span>
      <span className="truncate text-[14px]">{entry.name}</span>
      <span className="-mt-1 flex justify-between gap-2 text-[12px]">
        <span className="truncate text-tungsten/80">@{handleOf(entry.name)}</span>
        <span className="shrink-0 text-faint">{countLabel(entry, tr)}</span>
      </span>
    </button>
  );
}

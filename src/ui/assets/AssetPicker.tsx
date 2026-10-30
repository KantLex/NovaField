"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { Check, ChevronLeft, Library, LoaderCircle, Search, Star, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ASSET_KINDS, countLabel, coverOf, handleOf, type AssetEntry, type AssetItem, type AssetKind, type Purpose } from "@/lib/assets";
import type { Asset } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { api, fail } from "../api";
import { useLive } from "../state";
import { ensureAssets, prepareAsset, useAssets } from "./store";
import { tr } from "@/i18n";
import { useReveal } from "../reveal";

export type Media = AssetItem["kind"];

/** Finished takes with a file the slot can use (a clip for a video slot, a picture for an image slot), newest first. */
export function takesFor(jobs: Record<string, Job>, media: Media[]): Job[] {
  return Object.values(jobs)
    .filter((j) => j.status === "done" && !j.dryRun && ((media.includes("video") && !!j.video) || (media.includes("image") && !!j.image)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Pick from the asset library, or from the takes made in the Studio. "group" mode (the cast) takes a whole asset in one click, every
 * picture of a character at once; "single" mode (a frame, a clip slot) takes one file.
 */
export function AssetPicker({
  media,
  purpose,
  mode,
  room = 9,
  onPick,
  onClose,
}: {
  media: Media[];
  purpose: Purpose;
  mode: "group" | "single";
  /** How many files the slot still takes. */
  room?: number;
  onPick: (assets: Asset[]) => void;
  onClose: () => void;
}) {
  const list = useAssets((s) => s.list);
  const loaded = useAssets((s) => s.loaded);
  const jobs = useLive((s) => s.jobs);
  const takes = useMemo(() => takesFor(jobs, media), [jobs, media]);
  const hasAssets = list.some((e) => e.items.some((i) => media.includes(i.kind)));
  const [kind, setKind] = useState<AssetKind | "all" | "takes">(() => (!hasAssets && takes.length ? "takes" : "all"));
  const reveal = useReveal(kind);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    ensureAssets();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const usable = (e: AssetEntry) => e.items.filter((i) => media.includes(i.kind));
  const needle = q.trim().toLowerCase();
  const shown = list.filter(
    (e) => usable(e).length > 0 && (kind === "all" || e.kind === kind) && (!needle || `${e.name} ${e.description}`.toLowerCase().includes(needle)),
  );
  const entry = open ? list.find((e) => e.id === open) : null;
  const shownTakes = takes.filter((j) => !needle || j.title.toLowerCase().includes(needle)).slice(0, 60);

  const pickTake = async (j: Job) => {
    setBusy(j.id);
    try {
      onPick([await api.useTake(j.id, purpose)]);
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const take = async (e: AssetEntry, items?: string[]) => {
    const pick = (items ?? usable(e).map((i) => i.id)).slice(0, mode === "single" ? 1 : room);
    if (!pick.length) return;
    setBusy(e.id);
    try {
      onPick(await prepareAsset(e.id, purpose, pick));
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={tr("Pick from assets")}
    >
      <motion.div
        className="flex max-h-full w-full max-w-[880px] flex-col overflow-hidden rounded-md bg-panel shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_24px_80px_rgba(0,0,0,0.7)]"
        initial={{ y: 10 }}
        animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
          {entry ? (
            <button onClick={() => (setOpen(null), setChosen(new Set()))} className="flex items-center gap-1 text-[13px] text-dim hover:text-ink">
              <ChevronLeft size={15} /> {tr("All assets")}
            </button>
          ) : (
            <Library size={17} className="text-tungsten" />
          )}
          <div className="mr-auto min-w-0">
            <h2 className="display truncate text-[18px] leading-tight">{entry ? entry.name : "Assets"}</h2>
            <p className="text-[12px] text-dim">
              {entry
                ? mode === "group"
                  ? tr("Choose pictures, or take all {n}.", { n: Math.min(room, usable(entry).length) })
                  : tr("Choose one.")
                : kind === "takes"
                  ? tr("Pick a take you made in the Studio.")
                  : mode === "group"
                  ? room < 9
                    ? tr("Click an asset to bring in all its pictures (room for {n}).", { n: room })
                    : tr("Click an asset to bring in all its pictures.")
                  : tr(media.length === 1 ? (media[0] === "image" ? "Pick an image you've registered." : media[0] === "video" ? "Pick a video you've registered." : "Pick an audio clip you've registered.") : "Pick a file you've registered.")}
            </p>
          </div>
          {!entry && (
            <label className="flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-md bg-surround px-2.5 sm:max-w-[240px]">
              <Search size={14} className="text-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search")} className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none" aria-label={tr("Search assets")} />
            </label>
          )}
          <button onClick={onClose} className="rounded p-1 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Close")}>
            <X size={18} />
          </button>
        </header>

        {!entry && (
          <div className="flex flex-wrap gap-1 border-b border-line/50 px-4 py-2" role="tablist" aria-label={tr("Asset types")}>
            {[{ id: "all" as const, plural: "All" }, ...ASSET_KINDS, ...(takes.length ? [{ id: "takes" as const, plural: "Studio takes" }] : [])].map((k) => (
              <button
                key={k.id}
                role="tab"
                aria-selected={kind === k.id}
                onClick={() => setKind(k.id)}
                className={clsx("rounded-full px-2.5 py-1 text-[12px]", kind === k.id ? "bg-tungsten text-black" : "bg-surround text-dim hover:text-ink")}
              >
                {tr(k.plural)}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-[200px] overflow-y-auto p-4">
          {entry ? (
            <EntryFiles
              entry={entry}
              files={usable(entry)}
              mode={mode}
              chosen={chosen}
              onToggle={(id) =>
                mode === "single"
                  ? void take(entry, [id])
                  : setChosen((s) => {
                      const n = new Set(s);
                      if (n.has(id)) n.delete(id);
                      else if (n.size < room) n.add(id);
                      return n;
                    })
              }
            />
          ) : kind === "takes" ? (
            shownTakes.length ? (
              <div key={reveal.key} className={clsx("grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3", reveal.className)}>
                {shownTakes.map((j) => (
                  <TakeTile key={j.id} job={j} video={media.includes("video") && !!j.video} busy={busy === j.id} onPick={() => void pickTake(j)} />
                ))}
              </div>
            ) : (
              <p className="py-6 text-[14px]">{tr("Nothing here matches.")}</p>
            )
          ) : !loaded ? (
            <p className="flex items-center gap-2 text-[13px] text-dim">
              <LoaderCircle size={14} className="animate-spin" /> {tr("Loading your assets…")}
            </p>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-start gap-2 py-6 text-[14px]">
              <p>{tr(list.length ? "Nothing here matches." : "No assets yet.")}</p>
              <p className="text-[13px] text-dim">{tr("Register a character once, with all its pictures, and bring it into any shot with one click.")}</p>
              <Link href="/assets" onClick={onClose} className="mt-1 rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
                {tr("Open Assets")}
              </Link>
            </div>
          ) : (
            <div key={reveal.key} className={clsx("grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3", reveal.className)}>
              {shown.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  count={usable(e).length}
                  busy={busy === e.id}
                  hint={mode === "group" ? "Add all" : usable(e).length === 1 ? "Use" : "Choose"}
                  hintText={tr(mode === "group" ? "Add all" : usable(e).length === 1 ? "Use" : "Choose")}
                  onPick={() => (mode === "group" || usable(e).length === 1 ? void take(e) : setOpen(e.id))}
                  onOpen={() => setOpen(e.id)}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-line/70 px-4 py-2.5">
          <Link href="/assets" onClick={onClose} className="text-[12px] text-dim hover:text-ink">
            {tr("Manage assets")}
          </Link>
          {entry && mode === "group" && (
            <div className="ml-auto flex items-center gap-2">
              <button
                disabled={!chosen.size || !!busy}
                onClick={() => void take(entry, [...chosen])}
                className="rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover disabled:opacity-40"
              >
                Add {chosen.size || ""} chosen
              </button>
              <button disabled={!!busy} onClick={() => void take(entry)} className="flex items-center gap-1.5 rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
                {busy === entry.id && <LoaderCircle size={13} className="animate-spin" />}
                {tr("Add all")}
              </button>
            </div>
          )}
        </footer>
      </motion.div>
    </motion.div>
  );
}

function EntryCard({
  entry,
  count,
  busy,
  hint,
  hintText,
  onPick,
  onOpen,
}: {
  entry: AssetEntry;
  count: number;
  busy: boolean;
  hint: string;
  hintText: string;
  onPick: () => void;
  onOpen: () => void;
}) {
  const cover = coverOf(entry);
  const kind = ASSET_KINDS.find((k) => k.id === entry.kind);
  return (
    <article className="group flex flex-col gap-1.5">
      <button onClick={onPick} disabled={busy} className="relative aspect-[4/5] overflow-hidden rounded-[5px] bg-surround shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]">
        {cover?.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.poster} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-ink/90">{tr(kind?.label ?? "")}</span>
        {entry.favorite && <Star size={12} className="absolute top-1.5 right-1.5 fill-tungsten text-tungsten" />}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/85 to-transparent pt-8 pb-2 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-md bg-tungsten px-2.5 py-1 text-[12px] font-semibold text-black">
            {busy && <LoaderCircle size={12} className="animate-spin" />}
            {hintText}
            {hint === "Add all" ? ` ${count}` : ""}
          </span>
        </span>
      </button>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px]">{entry.name}</span>
        {count > 1 && (
          <button onClick={onOpen} className="shrink-0 text-[11px] text-faint hover:text-ink">
            {countLabel(entry, tr)}
          </button>
        )}
      </div>
      <span className="-mt-1 truncate text-[11px] text-tungsten/80">@{handleOf(entry.name)}</span>
    </article>
  );
}

function TakeTile({ job, video, busy, onPick }: { job: Job; video: boolean; busy: boolean; onPick: () => void }) {
  const seconds = job.meta?.seconds;
  return (
    <article className="group flex flex-col gap-1.5">
      <button onClick={onPick} disabled={busy} className="relative aspect-video overflow-hidden rounded-[5px] bg-surround shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]">
        {(job.poster || job.image) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.poster || job.image} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        {video && <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 text-[10px] font-semibold text-ink/90">{tr("Video")}{seconds ? ` ${seconds.toFixed(1)}s` : ""}</span>}
        {job.favorite && <Star size={12} className="absolute top-1.5 right-1.5 fill-tungsten text-tungsten" />}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/85 to-transparent pt-8 pb-2 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-md bg-tungsten px-2.5 py-1 text-[12px] font-semibold text-black">
            {busy && <LoaderCircle size={12} className="animate-spin" />}
            {tr("Use")}
          </span>
        </span>
      </button>
      <span className="truncate text-[12px] text-dim" title={job.title}>{job.title}</span>
    </article>
  );
}

function EntryFiles({ entry, files, mode, chosen, onToggle }: { entry: AssetEntry; files: AssetItem[]; mode: "group" | "single"; chosen: Set<string>; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {entry.description && <p className="max-w-[70ch] text-[13px] text-dim">{entry.description}</p>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5">
        {files.map((it) => {
          const on = chosen.has(it.id);
          return (
            <button
              key={it.id}
              onClick={() => onToggle(it.id)}
              aria-pressed={mode === "group" ? on : undefined}
              className={clsx(
                "relative aspect-[4/5] overflow-hidden rounded-[5px] bg-surround",
                on ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]",
              )}
            >
              {it.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.poster} alt={it.label ?? ""} className="size-full object-cover" />
              )}
              {it.kind !== "image" && <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 text-[10px] font-semibold">{it.kind === "video" ? `Video ${it.duration ? `${it.duration.toFixed(1)}s` : ""}` : "Audio"}</span>}
              {it.label && <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-left text-[11px]">{it.label}</span>}
              {on && (
                <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-tungsten text-black">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

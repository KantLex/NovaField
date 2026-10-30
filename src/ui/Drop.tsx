"use client";

import clsx from "clsx";
import { AnimatePresence } from "motion/react";
import { Library, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/engines/specs";
import { api, fail, toast } from "./api";
import { AssetPicker, takesFor, type Media } from "./assets/AssetPicker";
import { ensureAssets, useAssets } from "./assets/store";
import { isTakeDrag, takesFrom, useTakeDrag } from "./dragTakes";
import { useLive } from "./state";
import { tr } from "@/i18n";

/** What a file input's accept string lets in. */
const mediaOf = (accept: string): Media[] =>
  (["image", "video", "audio"] as const).filter((m) => accept === "*" || accept.includes(`${m}/`) || accept.includes("*/*"));

/**
 * A drop target that uploads (and conforms) files, then hands back ComfyUI-ready assets. Takes
 * dragged from the Library or the strip work too. A corner button picks from the asset library or
 * the Studio's takes instead, when they have something that fits.
 */
export function Drop({
  purpose,
  accept,
  multiple,
  onAsset,
  className,
  children,
  tone = "tungsten",
  assets = true,
}: {
  purpose: "image" | "h3" | "wan" | "raw";
  accept: string;
  multiple?: boolean;
  onAsset: (a: Asset) => void;
  className?: string;
  children: (state: { busy: boolean; over: boolean }) => React.ReactNode;
  tone?: "tungsten" | "daylight";
  /** Offer the asset library and the Studio's takes in a picker (default on). Dragged takes are always taken. */
  assets?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const media = mediaOf(accept);
  const hasLibrary = useAssets((s) => assets && s.list.some((e) => e.items.some((i) => media.includes(i.kind))));
  const hasTakes = useLive((s) => assets && takesFor(s.jobs, media).length > 0);
  const hasAssets = hasLibrary || hasTakes;
  // A take being dragged that this slot can use: show where it can go before it gets here.
  const offered = useTakeDrag((s) => !!s.media?.some((m) => media.includes(m)));
  useEffect(() => {
    if (assets) ensureAssets();
  }, [assets]);

  const take = async (files: FileList | null) => {
    if (!files?.length) return;
    // A drop skips the picker's accept filter: a clip dropped on a picture slot is refused here.
    const fitting = Array.from(files).filter((f) => !media.length || media.some((m) => f.type.startsWith(`${m}/`)));
    if (fitting.length < files.length) toast(tr(media[0] === "image" ? "This slot takes pictures." : media[0] === "video" ? "This slot takes video clips." : "This slot takes audio."), "error");
    if (!fitting.length) return;
    setBusy(true);
    try {
      for (const f of fitting.slice(0, multiple ? 9 : 1)) onAsset(await api.upload(f, purpose));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const takeTakes = async (dropped: string[]) => {
    // As it is ("raw"), a take is whatever file it made, so it has to be the kind the slot takes.
    const jobs = useLive.getState().jobs;
    const made = (id: string): Media | null => (jobs[id]?.video ? "video" : jobs[id]?.image ? "image" : jobs[id]?.audio ? "audio" : null);
    const ids = purpose === "raw" && media.length ? dropped.filter((id) => media.includes(made(id) as Media)) : dropped;
    if (ids.length < dropped.length) toast(tr(media[0] === "image" ? "This slot takes pictures." : media[0] === "video" ? "This slot takes video clips." : "This slot takes audio."), "error");
    if (!ids.length) return;
    setBusy(true);
    try {
      for (const id of ids.slice(0, multiple ? 9 : 1)) onAsset(await api.useTake(id, purpose));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (isTakeDrag(e)) e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (isTakeDrag(e)) void takeTakes(takesFrom(e));
        else void take(e.dataTransfer.files);
      }}
      className={clsx(
        "relative cursor-pointer",
        over && (tone === "daylight" ? "ring-2 ring-daylight" : "ring-2 ring-tungsten"),
        // The dashed outline replaces outline-none (both set the outline style, and that one would win).
        offered && !over
          ? tone === "daylight"
            ? "outline-2 outline-offset-2 outline-daylight/70 outline-dashed"
            : "outline-2 outline-offset-2 outline-tungsten/70 outline-dashed"
          : "outline-none",
        className,
      )}
    >
      <input ref={input} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => void take(e.target.files)} />
      {children({ busy, over })}
      {hasAssets && !busy && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setPicking(true);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="absolute right-1 bottom-1 z-10 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-ink/85 backdrop-blur hover:bg-black hover:text-tungsten"
          title={tr("Pick from your assets")}
          aria-label={tr("Pick from assets")}
        >
          <Library size={11} /> {tr("Assets")}
        </button>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/55">
          <LoaderCircle className="animate-spin text-ink" size={18} />
        </div>
      )}
    </div>
    {/* Outside the drop target, so clicks in the picker don't open the file dialog. */}
      <AnimatePresence>
        {picking && (
          <AssetPicker
            media={media}
            purpose={purpose}
            mode={multiple ? "group" : "single"}
            onPick={(list) => list.forEach(onAsset)}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

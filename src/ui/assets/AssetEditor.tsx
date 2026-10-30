"use client";

// Editing a saved asset: its name, description and files.

import clsx from "clsx";
import { ArrowLeft, ArrowRight, Clapperboard, LoaderCircle, Star, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { countLabel, handleOf, type AssetEntry } from "@/lib/assets";
import { fail, toast } from "@/ui/api";
import { IconButton } from "@/ui/controls";
import { prepareAsset, useAssets } from "@/ui/assets/store";
import { useStudio } from "@/ui/state";
import { tr } from "@/i18n";
import { DescriptionInput, FileDrop, KindChips, NameInput } from "@/ui/assets/AssetForm";

export function Editor({ entry, onClose }: { entry: AssetEntry; onClose: () => void }) {
  const { update, remove, addFiles, removeItem } = useAssets.getState();
  const router = useRouter();
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const [adding, setAdding] = useState(false);
  const [casting, setCasting] = useState(false);
  const cast = useStudio((s) => s.shot.cast);
  const images = entry.items.filter((i) => i.kind === "image");
  const inCast = cast.filter((c) => c.group === entry.id).length;
  const room = 9 - cast.filter((c) => c.group !== entry.id).length;

  const save = (p: Parameters<typeof update>[1]) => update(entry.id, p).catch(fail);
  const move = (id: string, d: number) => {
    const order = entry.items.map((i) => i.id);
    const at = order.indexOf(id);
    const to = at + d;
    if (to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    void save({ order });
  };

  const toCast = async () => {
    setCasting(true);
    try {
      const ready = await prepareAsset(entry.id, "image", images.slice(0, room).map((i) => i.id));
      const { shot, patch } = useStudio.getState();
      // Replace this asset's pictures if it's already cast; keep everyone else.
      patch({ cast: [...shot.cast.filter((c) => c.group !== entry.id), ...ready].slice(0, 9) });
      toast(
        ready.length === 1
          ? tr("{name} is in the cast: 1 picture. Mention @{handle} in the script.", { name: entry.name, handle: handleOf(entry.name) })
          : tr("{name} is in the cast: {n} pictures. Mention @{handle} in the script.", { name: entry.name, n: ready.length, handle: handleOf(entry.name) }),
        "done",
      );
      router.push("/");
    } catch (e) {
      fail(e);
    } finally {
      setCasting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-md bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <KindChips value={entry.kind} onChange={(kind) => void save({ kind })} />
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => void save({ favorite: !entry.favorite })}
            className={clsx("rounded p-1 hover:bg-raised", entry.favorite ? "text-tungsten" : "text-dim hover:text-ink")}
            aria-pressed={!!entry.favorite}
            aria-label={tr("Star")}
            title={tr("Star: starred assets come first everywhere")}
          >
            <Star size={16} className={entry.favorite ? "fill-tungsten" : ""} />
          </button>
          <button onClick={onClose} className="rounded p-1 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Close")}>
            <X size={16} />
          </button>
        </div>
      </div>

      <NameInput value={name} onChange={setName} onBlur={() => name.trim() && name !== entry.name && void save({ name })} />
      <DescriptionInput value={description} onChange={setDescription} kind={entry.kind} onBlur={() => description !== entry.description && void save({ description })} />

      {images.length > 0 && (
        <button
          onClick={() => void toCast()}
          disabled={casting || room <= 0}
          className="flex items-center justify-center gap-2 rounded-md bg-tungsten px-3 py-2 text-[14px] font-semibold text-black disabled:opacity-50"
        >
          {casting ? <LoaderCircle size={14} className="animate-spin" /> : <Clapperboard size={15} />}
          {inCast
            ? tr("Refresh in the Studio cast")
            : Math.min(images.length, room) === 1
              ? tr("Put in the Studio cast (1 picture)")
              : tr("Put in the Studio cast ({n} pictures)", { n: Math.min(images.length, room) })}
        </button>
      )}
      {images.length > room && room > 0 && <p className="-mt-2 text-[12px] text-faint">{tr("The cast holds 9 pictures; the first {n} go in. Reorder to choose which.", { n: room })}</p>}

      <div className="flex flex-col gap-2">
        <span className="flex items-baseline justify-between text-[13px] font-semibold text-dim">
          {tr("Files")} <span className="text-[12px] font-normal text-faint">{countLabel(entry, tr)}</span>
        </span>
        <div className="grid grid-cols-3 gap-2">
          {entry.items.map((it, i) => (
            <figure key={it.id} data-asset-item={it.id} className="group flex flex-col gap-1">
              <div className={clsx("relative aspect-[4/5] overflow-hidden rounded-[4px] bg-surround", entry.cover === it.id && "shadow-[0_0_0_2px_var(--color-tungsten)]")}>
                {it.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.poster} alt={it.label ?? ""} className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-[11px] text-dim">{tr("Audio")}</span>
                )}
                {it.kind === "video" && <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px]">{it.duration ? `${it.duration.toFixed(1)}s` : "Video"}</span>}
                <div className="absolute inset-x-0 bottom-0 flex justify-between bg-gradient-to-t from-black/85 to-transparent p-1 pt-5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <span className="flex gap-0.5">
                    <IconButton tone="overlay" label="Move earlier" onClick={() => move(it.id, -1)} disabled={i === 0}>
                      <ArrowLeft size={12} />
                    </IconButton>
                    <IconButton tone="overlay" label="Move later" onClick={() => move(it.id, 1)} disabled={i === entry.items.length - 1}>
                      <ArrowRight size={12} />
                    </IconButton>
                  </span>
                  <span className="flex gap-0.5">
                    {it.poster && (
                      <IconButton tone="overlay" label="Use as cover" onClick={() => void save({ cover: it.id })}>
                        <Star size={12} className={entry.cover === it.id ? "fill-tungsten text-tungsten" : ""} />
                      </IconButton>
                    )}
                    <IconButton tone="overlay"
                      label={entry.items.length === 1 ? "Remove (the last file: removes the asset)" : "Remove"}
                      onClick={async () => {
                        if (entry.items.length === 1 && !confirm(tr("This is “{name}”'s last file. Removing it removes the asset too.", { name: entry.name }))) return;
                        try {
                          if (!(await removeItem(entry.id, it.id))) {
                            toast(tr("“{name}” had no files left, so it was removed.", { name: entry.name }), "done");
                            onClose();
                          }
                        } catch (e) {
                          fail(e);
                        }
                      }}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </span>
                </div>
              </div>
              <input
                defaultValue={it.label ?? ""}
                placeholder={tr("label")}
                maxLength={24}
                onBlur={(e) => e.target.value !== (it.label ?? "") && void save({ labels: { [it.id]: e.target.value } })}
                className="w-full rounded bg-transparent px-1 text-[12px] text-dim placeholder:text-faint focus:bg-surround focus:outline-none"
                aria-label={tr("Label for this file")}
              />
            </figure>
          ))}
          <FileDrop
            compact
            busy={adding}
            onFiles={async (f) => {
              setAdding(true);
              try {
                await addFiles(entry.id, f);
              } catch (e) {
                fail(e);
              } finally {
                setAdding(false);
              }
            }}
          />
        </div>
      </div>

      <button
        onClick={async () => {
          if (!confirm(tr("Delete “{name}” and its {n} files? Takes made with it are kept.", { name: entry.name, n: entry.items.length }))) return;
          try {
            await remove(entry.id);
            onClose();
          } catch (e) {
            fail(e);
          }
        }}
        className="flex items-center gap-1.5 self-start text-[12px] text-tally hover:underline"
      >
        <Trash2 size={12} /> {tr("Delete asset")}
      </button>
    </div>
  );
}

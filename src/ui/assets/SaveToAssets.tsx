"use client";

import clsx from "clsx";
import { BookmarkPlus, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ASSET_KINDS, coverOf, handleOf, type AssetKind } from "@/lib/assets";
import { fail, toast } from "../api";
import { Menu } from "../Menu";
import { ensureAssets, useAssets } from "./store";
import { tr } from "@/i18n";

export interface SaveChoice {
  url: string;
  label: string;
}

/**
 * Keep a take, a frame of it, or a cast picture in the asset library: as a new character
 * (object, place…) or as one more file of an existing one.
 */
export function SaveToAssets({ choices, suggestedName, suggestedKind = "character", compact }: { choices: SaveChoice[]; suggestedName?: string; suggestedKind?: AssetKind; compact?: boolean }) {
  if (!choices.length) return null;
  return (
    <Menu
      label={tr("Save to assets")}
      align="right"
      className="w-[280px]"
      trigger={() =>
        compact ? (
          <span className="rounded p-1 text-ink hover:bg-white/15">
            <BookmarkPlus size={14} />
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-md bg-raised px-3 py-1.5 text-[13px] hover:bg-hover">
            <BookmarkPlus size={14} /> {tr("Save to assets")}
          </span>
        )
      }
    >
      {(close) => <SaveToAssetsPanel choices={choices} suggestedName={suggestedName} suggestedKind={suggestedKind} close={close} />}
    </Menu>
  );
}

/** Save as a new asset or into an existing one: the body of "Save to assets", for any menu. */
export function SaveToAssetsPanel({ choices, suggestedName, suggestedKind = "character", close }: { choices: SaveChoice[]; suggestedName?: string; suggestedKind?: AssetKind; close: () => void }) {
  const list = useAssets((s) => s.list);
  const [which, setWhich] = useState(0);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>(suggestedKind);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => ensureAssets(), []);

  const save = async (target: { id: string; name: string } | null) => {
    const { create, addUrls } = useAssets.getState();
    setBusy(target?.id ?? "new");
    try {
      const entry = target ?? (await create({ name: name.trim() || suggestedName || tr(ASSET_KINDS.find((k) => k.id === kind)!.label), kind }));
      await addUrls(entry.id, [choices[which].url]);
      toast(target ? tr("Added to “{name}”.", { name: entry.name }) : tr("Saved as “{name}”. Mention it as @{handle}.", { name: entry.name, handle: handleOf(entry.name) }), "done");
      setName("");
      close();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2 p-1.5">
      {choices.length > 1 && (
        <div className="flex gap-0.5 rounded-md bg-surround p-0.5" role="radiogroup" aria-label={tr("What to save")}>
          {choices.map((c, i) => (
            <button
              key={c.url}
              role="radio"
              aria-checked={which === i}
              onClick={() => setWhich(i)}
              className={clsx("flex-1 rounded px-2 py-1 text-[12px]", which === i ? "bg-raised text-ink" : "text-dim hover:text-ink")}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save(null);
        }}
      >
        <span className="text-[12px] text-dim">{tr("As a new asset")}</span>
        <div className="flex flex-wrap gap-1">
          {ASSET_KINDS.map((k) => (
            <button
              type="button"
              key={k.id}
              onClick={() => setKind(k.id)}
              aria-pressed={kind === k.id}
              className={clsx("rounded-full px-2 py-0.5 text-[11px]", kind === k.id ? "bg-ink text-surround" : "bg-surround text-dim hover:text-ink")}
            >
              {tr(k.label)}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suggestedName || tr("Name")}
            maxLength={40}
            className="min-w-0 flex-1 rounded bg-surround px-2 py-1.5 text-[13px] focus:outline-none"
            aria-label={tr("Name for the new asset")}
          />
          <button type="submit" disabled={!!busy} className="flex items-center gap-1 rounded bg-tungsten px-2.5 text-[12px] font-semibold text-black disabled:opacity-50">
            {busy === "new" && <LoaderCircle size={12} className="animate-spin" />}
            {tr("Save")}
          </button>
        </div>
      </form>
      {list.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-line pt-1.5">
          <span className="px-1 text-[12px] text-dim">{tr("Or add to")}</span>
          <div className="flex max-h-[220px] flex-col overflow-y-auto">
            {list.map((e) => (
              <button
                key={e.id}
                disabled={!!busy}
                onClick={() => void save(e)}
                className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[13px] text-dim hover:bg-raised hover:text-ink"
              >
                <span className="size-6 shrink-0 overflow-hidden rounded-[3px] bg-surround">
                  {coverOf(e)?.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={coverOf(e)!.poster} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {busy === e.id && <LoaderCircle size={12} className="animate-spin" />}
                <span className="text-[11px] text-faint">{tr(ASSET_KINDS.find((k) => k.id === e.kind)?.label ?? "")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

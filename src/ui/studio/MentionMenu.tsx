"use client";

import clsx from "clsx";
import { Library } from "lucide-react";
import { ASSET_KINDS, coverOf, handleOf, type AssetEntry } from "@/lib/assets";
import type { Asset } from "@/lib/engines/specs";
import { tr } from "@/i18n";

export type Suggestion = { token: string; thumb?: string; note: string } & ({ from: "cast" } | { from: "asset"; entry: AssetEntry });

/** What "@que…" could mean: someone already in the cast, or an asset that isn't yet. */
export function suggestionsFor(query: string, cast: Asset[], assets: AssetEntry[]): Suggestion[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  cast.forEach((c, i) => {
    const token = c.label || String(i + 1);
    if (seen.has(token.toLowerCase())) return;
    seen.add(token.toLowerCase());
    const n = c.group ? cast.filter((x) => x.group === c.group).length : 1;
    out.push({ from: "cast", token, thumb: c.url, note: n > 1 ? tr("In the cast · {n} pictures", { n }) : tr("In the cast") });
  });
  for (const e of assets) {
    const token = handleOf(e.name);
    const images = e.items.filter((i) => i.kind === "image").length;
    if (!images || seen.has(token.toLowerCase())) continue;
    seen.add(token.toLowerCase());
    out.push({
      from: "asset",
      entry: e,
      token,
      thumb: coverOf(e)?.poster,
      note: `${tr(ASSET_KINDS.find((k) => k.id === e.kind)?.label ?? "")} · ${images === 1 ? tr("adds 1 picture") : tr("adds {n} pictures", { n: images })}`,
    });
  }
  return out.filter((s) => !q || s.token.toLowerCase().includes(q)).sort((a, b) => Number(!a.token.toLowerCase().startsWith(q)) - Number(!b.token.toLowerCase().startsWith(q))).slice(0, 8);
}

export function MentionMenu({ items, active, onPick, onHover }: { items: Suggestion[]; active: number; onPick: (s: Suggestion) => void; onHover: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <div role="listbox" aria-label={tr("Mention")} className="absolute top-full left-0 z-30 mt-1 w-[300px] max-w-full overflow-hidden rounded-md border border-line bg-panel p-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)]">
      {items.map((s, i) => (
        <button
          key={`${s.from}-${s.token}`}
          role="option"
          aria-selected={i === active}
          // Keep focus in the textarea.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(s);
          }}
          onMouseEnter={() => onHover(i)}
          className={clsx("flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left", i === active ? "bg-raised" : "")}
        >
          <span className="size-8 shrink-0 overflow-hidden rounded-[3px] bg-surround">
            {s.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.thumb} alt="" className="size-full object-cover" />
            )}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-tungsten">@{s.token}</span>
            <span className="flex items-center gap-1 truncate text-[11px] text-faint">
              {s.from === "asset" && <Library size={10} />}
              {s.note}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

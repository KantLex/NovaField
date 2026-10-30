"use client";

// Bringing workflows in: a dropped or pasted file, or one saved on the ComfyUI server.

import clsx from "clsx";
import { FileJson, LoaderCircle, Server } from "lucide-react";
import { useEffect, useState } from "react";
import type { RecipeSummary } from "@/lib/workflows/types";
import { fail, request, toast } from "@/ui/api";
import { useRecipes } from "@/ui/workflows/store";
import { tr } from "@/i18n";

export function ImportZone({ onImported }: { onImported: (r: RecipeSummary) => void }) {
  const upsert = useRecipes((s) => s.upsert);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const take = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const json = JSON.parse(await f.text());
      const r = await request<RecipeSummary>("/api/workflows", { json: { json, source: f.name } });
      upsert(r);
      onImported(r);
      toast(
        r.missing.length ? tr("Imported, but the server is missing: {nodes}.", { nodes: r.missing.join(", ") }) : tr("Imported “{name}”.", { name: r.name }),
        r.missing.length ? "error" : "done",
      );
    } catch (e) {
      fail(e instanceof SyntaxError ? new Error(tr("That file isn't valid JSON.")) : e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) void take(e.dataTransfer.files);
      }}
      className={clsx(
        "flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 text-center text-[13px] transition-colors",
        over ? "border-ink text-ink" : "border-line text-dim hover:border-dim hover:text-ink",
      )}
    >
      <input
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const input = e.currentTarget;
          // Cleared once read, so picking the same file again (after removing it) imports it again.
          void take(input.files).finally(() => (input.value = ""));
        }}
      />
      {busy ? <LoaderCircle size={18} className="animate-spin" /> : <FileJson size={18} />}
      {tr(busy ? "Reading the workflow…" : "Drop a workflow .json")}
      <span className="text-[12px] text-faint">{tr("Saved or API format, subgraphs included")}</span>
    </label>
  );
}

export function ServerWorkflows({ onImported }: { onImported: (r: RecipeSummary) => void }) {
  const upsert = useRecipes((s) => s.upsert);
  const [items, setItems] = useState<{ path: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    request<typeof items>("/api/workflows/server")
      .then(setItems)
      .catch(() => {});
  }, []);
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-line/60 pt-3">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-dim">
        <Server size={13} /> {tr("Saved in ComfyUI")}
      </h2>
      {items.slice(0, 30).map((it) => (
        <button
          key={it.path}
          disabled={!!busy}
          onClick={async () => {
            setBusy(it.path);
            try {
              const r = await request<RecipeSummary>("/api/workflows/server", { json: { path: it.path } });
              upsert(r);
              onImported(r);
            } catch (e) {
              fail(e);
            } finally {
              setBusy(null);
            }
          }}
          className="flex items-center gap-2 truncate rounded px-2 py-1 text-left text-[13px] text-dim hover:bg-surround hover:text-ink"
        >
          {busy === it.path && <LoaderCircle size={12} className="animate-spin" />}
          {it.path.replace(/\.json$/, "")}
        </button>
      ))}
    </div>
  );
}

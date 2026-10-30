"use client";

import clsx from "clsx";
import { motion } from "motion/react";
import { AudioLines, Box, ExternalLink, LayoutTemplate, LoaderCircle, Package, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RecipeSummary } from "@/lib/workflows/types";
import type { TemplateCard, TemplateLibrary } from "@/server/templates";
import { ApiError, fail, request, toast } from "../api";
import { useRecipes } from "./store";
import { tr } from "@/i18n";
import { useReveal } from "../reveal";

type Where = "all" | "local" | "api";
const WHERE: { id: Where; label: string; title: string }[] = [
  { id: "all", label: "All", title: "Every template" },
  { id: "local", label: "Runs on your GPU", title: "Open models that run on your ComfyUI PC" },
  { id: "api", label: "Paid API", title: "Runs on a partner API with Comfy account credits" },
];
const PACKS = "__packs";

let library: Promise<TemplateLibrary> | null = null;
const loadLibrary = () =>
  (library ??= request<TemplateLibrary>("/api/workflows/templates").catch((e: unknown) => {
    library = null;
    throw e instanceof ApiError && !e.body.error ? new Error("Couldn't load ComfyUI's templates.") : e;
  }));

/**
 * ComfyUI's template library (the same one as Workflow → Browse Templates), as a picker: choose
 * one and it becomes a NovaField workflow with its own form, or a Studio engine.
 */
export function TemplateBrowser({ onClose, onImported }: { onClose: () => void; onImported: (r: RecipeSummary) => void }) {
  const upsert = useRecipes((s) => s.upsert);
  const [lib, setLib] = useState<TemplateLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("Video");
  const reveal = useReveal(category);
  const [where, setWhere] = useState<Where>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    loadLibrary()
      .then(setLib)
      .catch((e: Error) => setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const matches = (t: TemplateCard) =>
    (where === "all" || (where === "api") === t.api) &&
    (!q || [t.title, t.description, ...t.tags, ...t.models].some((s) => s.toLowerCase().includes(q)));

  // Searching looks across every category; otherwise show the chosen one.
  const shown = useMemo(() => {
    if (!lib || category === PACKS) return [];
    const pool = q ? lib.categories.flatMap((c) => c.templates) : (lib.categories.find((c) => c.title === category)?.templates ?? []);
    const seen = new Set<string>();
    return pool.filter((t) => matches(t) && !seen.has(t.name) && seen.add(t.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, category, q, where]);

  const use = async (name: string, title: string, pack?: string) => {
    setBusy(pack ? `${pack}/${name}` : name);
    try {
      const summary = await request<RecipeSummary>("/api/workflows/templates", { json: { name, title, pack } });
      upsert(summary);
      onImported(summary);
      toast(
        tr(summary.missing.length ? "Added “{name}”. It needs node packs your server doesn't have yet." : "Added “{name}”.", { name: summary.name }),
        summary.missing.length ? "error" : "done",
      );
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={tr("ComfyUI templates")}
    >
      <motion.div
        className="flex h-full max-h-[880px] w-full max-w-[1280px] flex-col overflow-hidden rounded-md bg-panel shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_24px_80px_rgba(0,0,0,0.7)]"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-line/70 px-4 py-3">
          <LayoutTemplate size={18} className="text-tungsten" />
          <div className="mr-auto">
            <h2 className="display text-[19px] leading-tight">{tr("ComfyUI templates")}</h2>
            <p className="text-[12px] text-dim">{tr("The library that ships with your ComfyUI. Pick one and it becomes a workflow here, with its own form.")}</p>
          </div>
          <label className="flex h-8 min-w-[220px] flex-1 items-center gap-2 rounded-md bg-surround px-2.5 sm:max-w-[320px]">
            <Search size={14} className="text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("Search Wan, upscale, lip sync…")}
              className="min-w-0 flex-1 bg-transparent text-[13px] focus:outline-none"
              aria-label={tr("Search templates")}
            />
          </label>
          <div className="flex gap-0.5 rounded-md bg-surround p-0.5" role="radiogroup" aria-label={tr("Where it runs")}>
            {WHERE.map((w) => (
              <button
                key={w.id}
                role="radio"
                aria-checked={where === w.id}
                title={tr(w.title)}
                onClick={() => setWhere(w.id)}
                className={clsx("rounded px-2.5 py-1 text-[12px]", where === w.id ? "bg-raised text-ink" : "text-dim hover:text-ink")}
              >
                {tr(w.label)}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="rounded p-1 text-dim hover:bg-raised hover:text-ink" aria-label={tr("Close")}>
            <X size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[200px_minmax(0,1fr)]">
          <nav className="hidden flex-col gap-0.5 overflow-y-auto border-r border-line/70 p-2 md:flex" aria-label={tr("Template categories")}>
            {lib?.categories.map((c, i) => {
              const n = c.templates.filter(matches).length;
              const first = i === 0 || lib.categories[i - 1].group !== c.group;
              return (
                <div key={c.title}>
                  {first && c.group && <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{tr(c.group)}</p>}
                  <CategoryButton label={c.title} count={n} active={!q && category === c.title} onPick={() => (setQuery(""), setCategory(c.title))} />
                </div>
              );
            })}
            {!!lib?.packs.length && (
              <>
                <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{tr("Your node packs")}</p>
                <CategoryButton label={tr("Pack examples")} count={lib.packs.length} active={!q && category === PACKS} onPick={() => (setQuery(""), setCategory(PACKS))} />
              </>
            )}
          </nav>

          <div className="min-h-0 overflow-y-auto p-3">
            {/* Narrow screens: categories as a select. */}
            {lib && (
              <select
                value={category}
                onChange={(e) => (setQuery(""), setCategory(e.target.value))}
                className="mb-3 w-full rounded-md bg-surround px-2 py-1.5 text-[13px] md:hidden"
                aria-label={tr("Category")}
              >
                {lib.categories.map((c) => (
                  <option key={c.title} value={c.title}>
                    {tr(c.title)}
                  </option>
                ))}
                {!!lib.packs.length && <option value={PACKS}>{tr("Pack examples")}</option>}
              </select>
            )}

            {error && <p className="rounded-md bg-tally/10 px-3 py-2 text-[13px] text-tally">{error}</p>}
            {!lib && !error && (
              <p className="flex items-center gap-2 text-[13px] text-dim">
                <LoaderCircle size={14} className="animate-spin" /> {tr("Reading ComfyUI's template library…")}
              </p>
            )}

            {lib && category === PACKS && !q ? (
              <div className="flex flex-col gap-1">
                <p className="mb-2 text-[13px] text-dim">{tr("Example workflows that came with the custom node packs on your server.")}</p>
                {lib.packs.map((p) => (
                  <button
                    key={`${p.pack}/${p.name}`}
                    disabled={!!busy}
                    onClick={() => void use(p.name, p.name.replace(/[_-]+/g, " "), p.pack)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-[14px] hover:bg-surround"
                  >
                    {busy === `${p.pack}/${p.name}` ? <LoaderCircle size={14} className="animate-spin" /> : <Package size={14} className="text-dim" />}
                    <span className="flex-1">{p.name.replace(/[_-]+/g, " ")}</span>
                    <span className="text-[12px] text-faint">{p.pack}</span>
                  </button>
                ))}
              </div>
            ) : (
              lib && (
                <>
                  {q && (
                    <p className="mb-2 text-[13px] text-dim">
                      {shown.length === 1 ? tr("1 template matches “{query}”", { query: query.trim() }) : tr("{n} templates match “{query}”", { n: shown.length, query: query.trim() })}
                    </p>
                  )}
                  {!shown.length && !q && <p className="text-[13px] text-dim">{tr("Nothing here with this filter.")}</p>}
                  <div key={reveal.key} className={clsx("grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3", reveal.className)}>
                    {shown.map((t) => (
                      <Card key={t.name} t={t} busy={busy === t.name} disabled={!!busy} onUse={() => void use(t.name, t.title)} />
                    ))}
                  </div>
                </>
              )
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CategoryButton({ label, count, active, onPick }: { label: string; count: number; active: boolean; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      aria-current={active ? "true" : undefined}
      className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", active ? "bg-raised text-ink" : "text-dim hover:bg-surround hover:text-ink")}
    >
      <span className="flex-1 truncate">{tr(label)}</span>
      <span className="readout text-[12px] text-faint">{count}</span>
    </button>
  );
}

function Card({ t, busy, disabled, onUse }: { t: TemplateCard; busy: boolean; disabled: boolean; onUse: () => void }) {
  const src = `/api/workflows/templates/thumb?name=${encodeURIComponent(t.name)}&ext=${t.thumb}`;
  const still = ["webp", "png", "jpg", "jpeg", "gif"].includes(t.thumb);
  const moving = ["mp4", "webm"].includes(t.thumb);
  return (
    <article className="group flex flex-col overflow-hidden rounded-md bg-surround shadow-[0_0_0_1px_var(--color-line)] transition-shadow hover:shadow-[0_0_0_1px_var(--color-dim)]">
      <button onClick={onUse} disabled={disabled} className="relative block aspect-video w-full overflow-hidden bg-black" aria-label={tr("Use {name}", { name: t.title })}>
        {still ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : moving ? (
          <video
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            className="size-full object-cover"
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-faint">{t.media === "audio" ? <AudioLines size={28} /> : <Box size={28} />}</span>
        )}
        <span className="absolute top-1.5 left-1.5 flex gap-1">
          {t.api ? (
            <span className="rounded bg-daylight/90 px-1.5 text-[10px] font-semibold text-black">{tr("Paid API")}</span>
          ) : (
            <span className="rounded bg-black/70 px-1.5 text-[10px] font-semibold text-ink/85">{tr("Local")}</span>
          )}
        </span>
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : null} {tr(busy ? "Adding…" : "Use template")}
          </span>
        </span>
      </button>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="text-[14px] leading-snug">{t.title}</h3>
        <p className="line-clamp-2 text-[12px] text-dim" title={t.description}>
          {t.description}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
          {t.models.slice(0, 2).map((m) => (
            <span key={m} className="rounded bg-panel px-1.5 py-px text-[11px] text-ink/75">
              {m}
            </span>
          ))}
          {t.tutorial && (
            <a href={t.tutorial} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-0.5 text-[11px] text-faint hover:text-ink">
              {tr("Guide")} <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

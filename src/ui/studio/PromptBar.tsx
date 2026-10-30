"use client";

import clsx from "clsx";
import { AudioLines, Film, Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Compiled } from "@/lib/engines";
import { RIG_OFF_NOTE } from "@/lib/engines/h3";
import type { GraphPrice } from "@/lib/comfy/credits";
import type { ShotSpec } from "@/lib/engines/specs";
import { api, fail, toast } from "../api";
import { Segmented } from "../controls";
import { randomSeed, useLive, useStudio, type ShotDraft } from "../state";
import { prepareAsset, ensureAssets, useAssets } from "../assets/store";
import { useEngineOutput } from "./engine";
import { MentionMenu, suggestionsFor, type Suggestion } from "./MentionMenu";
import { creditsLabel, priceDetail, usdLabel } from "../cost";
import { onReuseFocus } from "../reuse";
import { tr } from "@/i18n";

export function draftToSpec(d: ShotDraft, seed: number, over: Partial<ShotSpec> = {}): ShotSpec {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { takes, lockSeed, extendFrom, ...rest } = d;
  // Pack features the server lacks fall back quietly; the panel already says so.
  const pack = useLive.getState().status?.caps.pack;
  return {
    ...rest,
    cameraMode: pack?.ghostRig ? rest.cameraMode : "prompt",
    filmOnGpu: pack?.lensFilm ? rest.filmOnGpu : false,
    kind: "shot",
    seed,
    ...(extendFrom ? { extend: { fromJob: extendFrom, overlapFrames: 22 } } : {}),
    ...over,
  };
}

/** Rough render time on a 24 GB RTX 4090, from measured takes. */
export function estimateSeconds(meta: Compiled["meta"], turbo: boolean) {
  const base = meta.frames / (meta.fps > 24 ? 2 : 1);
  const mpf = (meta.width * meta.height * base) / 1e6;
  let s = mpf * 1.36 * (turbo ? 1 : 2.5);
  if (meta.width * meta.height > 1.5e6) s *= 1.35;
  if (meta.fps > 24) s += base * 0.06;
  return s + 12;
}

export const formatEta = (s: number) => (s < 90 ? tr("about {n} s", { n: Math.max(1, Math.round(s / 10) * 10) }) : tr("about {n} min", { n: Math.round(s / 60) }));

export function PromptBar() {
  const shot = useStudio((s) => s.shot);
  const patch = useStudio((s) => s.patch);
  const setFocus = useLive((s) => s.setFocus);
  const status = useLive((s) => s.status);
  const [pre, setPre] = useState<{ key: string; meta?: Compiled["meta"]; issues: { classType: string; input?: string; message: string }[]; blocker: string | null; paid: string[]; price: GraphPrice | null } | null>(null);
  const [rolling, setRolling] = useState(false);
  const output = useEngineOutput();
  const text = useRef<HTMLTextAreaElement>(null);
  // After "Reuse" on a take, put the cursor at the end of the loaded prompt.
  useEffect(
    () =>
      onReuseFocus(() =>
        requestAnimationFrame(() => {
          const el = text.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }),
      ),
    [],
  );
  const assets = useAssets((s) => s.list);
  // "@que" being typed: where it starts, and what's been typed after the @.
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [activeMention, setActiveMention] = useState(0);
  useEffect(() => ensureAssets(), []);
  const suggestions = mention ? suggestionsFor(mention.query, shot.cast, assets) : [];

  const watchMention = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const m = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(el.value.slice(0, caret));
    setMention(m ? { start: caret - m[2].length - 1, query: m[2] } : null);
    setActiveMention(0);
  };

  const pickMention = async (sug: Suggestion) => {
    const el = text.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? shot.prompt.length;
    const next = `${shot.prompt.slice(0, mention.start)}@${sug.token} ${shot.prompt.slice(caret)}`;
    const at = mention.start + sug.token.length + 2;
    patch({ prompt: next });
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(at, at);
    });
    if (sug.from !== "asset") return;
    // Not cast yet: bring every picture of it in.
    const { cast } = useStudio.getState().shot;
    const room = 9 - cast.length;
    if (room <= 0) return toast("The cast is full (9 pictures). Remove someone to bring this asset in.", "error");
    try {
      const images = sug.entry.items.filter((i) => i.kind === "image").slice(0, room);
      const ready = await prepareAsset(sug.entry.id, "image", images.map((i) => i.id));
      const now = useStudio.getState().shot.cast.filter((c) => c.group !== sug.entry.id);
      patch({ cast: [...now, ...ready].slice(0, 9) });
      toast(ready.length === 1 ? tr("{name} joined the cast with 1 picture.", { name: sug.entry.name }) : tr("{name} joined the cast with {n} pictures.", { name: sug.entry.name, n: ready.length }), "done");
    } catch (e) {
      fail(e);
    }
  };

  // The spec depends on the server's pack features too (draftToSpec falls back without them).
  const packKey = JSON.stringify(status?.caps.pack ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const specKey = useMemo(() => JSON.stringify(draftToSpec(shot, 1)), [shot, packKey]);
  useEffect(() => {
    // Answers can come back out of order: only the latest request's answer is shown.
    let current = true;
    const t = setTimeout(() => {
      api
        .preflight(draftToSpec(shot, 1))
        .then((r) => current && setPre({ key: specKey, meta: r.meta ?? undefined, issues: r.issues, blocker: r.blocker, paid: r.paid ?? [], price: r.price ?? null }))
        .catch(() => current && setPre(null));
    }, 450);
    return () => {
      current = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, status?.online]);

  // A ref, not just state: two quick presses happen before the re-render that disables the button.
  const rollingNow = useRef(false);
  const roll = async (coverage = false) => {
    if (rollingNow.current) return;
    if (!shot.prompt.trim()) {
      text.current?.focus();
      toast("Write what happens in the shot first.");
      return;
    }
    // Only a check of these settings counts: one for the model picked a moment ago may still be
    // showing. The server checks again on submit either way.
    if (pre?.blocker && pre.key === specKey) return toast(pre.blocker, "error");
    rollingNow.current = true;
    setRolling(true);
    try {
      const specs: ShotSpec[] = coverage
        ? (["wide", "medium", "close"] as const).map((size) => draftToSpec(shot, shot.lockSeed ?? randomSeed(), { size }))
        : Array.from({ length: shot.takes }, () => draftToSpec(shot, shot.lockSeed ?? randomSeed()));
      const jobs = await api.submit(specs);
      setFocus(jobs[0].id);
      toast(coverage ? "Creating coverage: wide, medium and close." : jobs.length > 1 ? tr("Creating {n} takes.", { n: jobs.length }) : "Creating your take.");
    } catch (e) {
      fail(e);
    } finally {
      rollingNow.current = false;
      setRolling(false);
    }
  };

  // One chip per subject: a character with five pictures is still one @name.
  const mentions = [...new Map(shot.cast.map((c, i) => [c.label ? `@${c.label}` : `@${i + 1}`, i])).entries()].map(([token, i]) => ({ token, i }));
  const insert = (token: string) => {
    const el = text.current;
    const pos = el?.selectionStart ?? shot.prompt.length;
    const before = shot.prompt.slice(0, pos);
    const sep = before && !before.endsWith(" ") ? " " : "";
    patch({ prompt: `${before}${sep}${token} ${shot.prompt.slice(pos)}` });
    requestAnimationFrame(() => el?.focus());
  };

  const eta = pre?.meta && !shot.engine && pre.meta.width > 0 ? formatEta(estimateSeconds(pre.meta, shot.turbo)) : null;

  return (
    <div className="flex flex-col gap-2 rounded-md bg-panel p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="relative">
          <textarea
            ref={text}
            value={shot.prompt}
            onChange={(e) => {
              patch({ prompt: e.target.value });
              watchMention(e.target);
            }}
            onClick={(e) => watchMention(e.currentTarget)}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              if (suggestions.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveMention((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  void pickMention(suggestions[activeMention] ?? suggestions[0]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (!e.repeat) void roll();
              }
            }}
            rows={3}
            placeholder={tr("What happens in the shot? Type @ to bring in a character from your assets, e.g. @Mira steps out of the tram into the rain")}
            className="min-h-[76px] w-full resize-y rounded-md bg-surround px-3 py-2.5 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none focus-visible:ring-1 focus-visible:ring-tungsten/60"
            aria-label={tr("Script for this shot")}
            aria-autocomplete="list"
          />
          <MentionMenu items={suggestions} active={activeMention} onPick={(x) => void pickMention(x)} onHover={setActiveMention} />
          </div>
          {mentions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {mentions.map((m) => (
                <button key={m.token} onClick={() => insert(m.token)} className="rounded-full bg-surround px-2 py-0.5 text-[12px] text-tungsten hover:bg-raised">
                  {m.token}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-row items-stretch gap-2 md:w-[236px] md:flex-col">
          <Slate
            onRoll={() => roll()}
            disabled={rolling}
            verb={tr("Create")}
            cost={pre?.paid.length ? (creditsLabel(pre.price) ?? tr("Paid API")) : null}
            costDetail={pre?.price ? priceDetail(pre.price) : undefined}
          />
          <div className="flex flex-1 items-center gap-2">
            <div className="flex-1">
              <Segmented
                label={tr("Takes")}
                size="sm"
                value={shot.takes}
                onChange={(takes) => patch({ takes })}
                options={[1, 2, 3, 4].map((n) => ({ id: n, label: `×${n}`, title: `${n} take${n > 1 ? "s" : ""} with different seeds` }))}
              />
            </div>
            <button
              onClick={() => roll(true)}
              disabled={rolling}
              title={tr("Three takes of the same moment: wide, medium and close-up")}
              className="rounded-md bg-raised px-2.5 py-1.5 text-[12px] hover:bg-hover disabled:opacity-40"
            >
              {tr("Coverage")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-dim">
        {pre?.blocker ? (
          <span className="text-tally">{tr(pre.blocker)}</span>
        ) : pre?.meta ? (
          <>
            <span className="flex items-center gap-1.5 text-ink/80">
              <OutputBadge output={output} />
              {pre.meta.engine}
            </span>
            <span className="readout text-[13px]">
              {[pre.meta.width > 0 ? `${pre.meta.width}×${pre.meta.height}` : "", output !== "image" && pre.meta.seconds > 0 ? `${pre.meta.seconds.toFixed(1)} s` : ""]
                .filter(Boolean)
                .join(", ")}
              {output !== "image" && pre.meta.fps > 24 ? " at 48 fps" : ""}
            </span>
            {eta && <span>{tr("{eta} per take", { eta })}</span>}
            {pre.paid.length > 0 && (
              <span className="text-daylight" title={pre.price ? priceDetail(pre.price) : undefined}>
                {pre.price && creditsLabel(pre.price)
                  ? tr("API model: {usd} ({credits}) per take, billed to your Comfy account", { usd: usdLabel(pre.price), credits: creditsLabel(pre.price)! })
                  : tr("API model: billed to your Comfy account per take")}
              </span>
            )}
            {pre.meta.notes.map((n) =>
              n === RIG_OFF_NOTE ? (
                <span key={n} className="flex items-center gap-2 rounded-md bg-tungsten/12 px-2 py-0.5 text-tungsten">
                  {tr(n)}
                  <button onClick={() => patch({ cameraMode: "rig" })} className="rounded bg-tungsten px-1.5 py-px text-[11px] font-semibold text-black">
                    {tr("Turn on previs")}
                  </button>
                </span>
              ) : (
                <span key={n} className="text-tungsten">
                  {tr(n)}
                </span>
              ),
            )}
          </>
        ) : (
          <span>{status && !status.online && !status.dryRun
              ? tr(status.mode === "cloud" ? "Comfy Cloud isn't answering. Check your internet connection, or switch to Local at the top right." : "ComfyUI isn't answering. Start it, or switch to Cloud at the top right.")
              : tr("Checking the graph…")}</span>
        )}
        {pre?.issues.map((i) => (
          <span key={i.classType + i.input + i.message} className="text-tally">
            {i.classType}
            {i.input ? `.${i.input}` : ""}: {tr(i.message)}
          </span>
        ))}
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={shot.lockSeed !== null}
            onChange={(e) => patch({ lockSeed: e.target.checked ? randomSeed() : null })}
            className="accent-tungsten"
          />
          {tr("Lock seed")}
          {shot.lockSeed !== null && <span className="readout text-[13px] text-faint">{shot.lockSeed}</span>}
        </label>
      </div>
    </div>
  );
}

/** Says up front whether the engine makes a clip or a still. */
function OutputBadge({ output }: { output: "video" | "image" | "audio" }) {
  const Icon = output === "image" ? ImageIcon : output === "audio" ? AudioLines : Film;
  return (
    <span
      className={clsx(
        "flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-semibold",
        output === "image" ? "bg-ink text-surround" : output === "audio" ? "bg-daylight text-black" : "bg-tungsten text-black",
      )}
    >
      <Icon size={11} strokeWidth={2.5} aria-hidden />
      {tr(output === "image" ? "Still image" : output === "audio" ? "Audio" : "Video")}
    </span>
  );
}

/** The Create button: a slate, with the cost when the model runs on a paid API. */
function Slate({
  onRoll,
  disabled,
  verb,
  cost,
  costDetail,
}: {
  onRoll: () => void;
  disabled: boolean;
  verb: string;
  /** What one take costs on a paid API ("≈ 25 credits"); null when it runs free on a GPU. */
  cost: string | null;
  costDetail?: string;
}) {
  return (
    <button
      onClick={onRoll}
      disabled={disabled}
      className={clsx(
        "group relative flex flex-1 flex-col overflow-hidden rounded-md bg-black text-left shadow-[0_0_0_1px_rgba(255,255,255,0.08)] transition-transform active:translate-y-px disabled:opacity-60 md:flex-none",
      )}
      aria-label={`${verb}${cost ? `, ${cost}` : ""} (Ctrl+Enter)`}
      title={costDetail}
    >
      <span className="slate-stripes block h-[9px] w-full opacity-90 group-hover:brightness-110" aria-hidden />
      <span className="flex items-end justify-between gap-2 px-3 pt-1.5 pb-2">
        <span className="badge-type text-[26px] leading-none text-tungsten">{verb}</span>
        <span className="readout flex flex-col items-end text-[12px] leading-tight text-dim">
          <span>{tr("Ctrl ↵")}</span>
        </span>
      </span>
      {cost && <span className="readout -mt-1 px-3 pb-1.5 text-[12px] text-daylight">{cost}</span>}
    </button>
  );
}

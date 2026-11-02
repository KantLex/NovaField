"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { nearestAspect } from "@/lib/engines/sizing";
import type { Aspect, JobSpec } from "@/lib/engines/specs";
import { api, fail, toast } from "@/ui/api";
import { Button } from "@/ui/controls";
import { TakeActions } from "@/ui/TakeActions";
import { TakePlayer } from "@/ui/TakePlayer";
import { TakeStrip } from "@/ui/TakeStrip";
import { DEFAULT_FILM, randomSeed, useLive } from "@/ui/state";
import { formatEta, estimateSeconds } from "@/ui/studio/PromptBar";
import { creditsLabel, usdLabel } from "@/ui/cost";
import { columnWidth, SidePanel, usePanelKeys, usePanelOpen } from "@/ui/SidePanel";
import { tr } from "@/i18n";
import { clipOf, type G, KINDS, MODES, type Mode, modelOf, useG, workflowOf } from "@/ui/henshin/state";
import { Stage } from "@/ui/henshin/Stage";
import { ModePanel } from "@/ui/henshin/ModePanel";

const PANEL_WIDTH = "340px";

export default function HenshinPage() {
  const g = useG();
  const caps = useLive((s) => s.status?.caps);
  const focus = useLive((s) => (s.focus ? s.jobs[s.focus] : null));
  const setFocus = useLive((s) => s.setFocus);
  const [busy, setBusy] = useState(false);
  const panelOpen = usePanelOpen("henshin-settings");
  usePanelKeys({ right: "henshin-settings" });
  const [pre, setPre] = useState<{ key: string; engine: string; line: string; blocker: string | null; issues: string[]; notes: string[]; cost: string | null } | null>(null);
  const mode = MODES.find((m) => m.id === g.mode)!;
  const stillAspect: Aspect = g.still?.width && g.still.height ? nearestAspect(g.still.width, g.still.height) : "16:9";

  const spec = useMemo((): JobSpec | null => {
    const seed = 1;
    const source = clipOf(g);
    // An imported workflow runs it in place of the built-in models.
    const workflow = workflowOf(g);
    const engine = workflow ? { engine: workflow } : {};
    switch (g.mode) {
      case "recast":
        return source && g.character
          ? {
              kind: "recast",
              model: g.models.recast === "scail" ? "scail" : "h3",
              ...engine,
              source,
              target: g.target,
              character: g.character,
              extras: g.extras,
              notes: g.notes,
              audio: g.audio,
              quality: g.quality,
              seed,
            }
          : null;
      case "restyle":
        return source && (g.style.trim() || g.styleRef)
          ? {
              kind: "restyle",
              model: g.models.restyle === "vace" ? "vace" : "h3",
              ...engine,
              source,
              styleRef: g.styleRef,
              style: g.style,
              film: { ...DEFAULT_FILM, look: g.look },
              filmOnGpu: g.look !== "none",
              audio: g.audio,
              quality: g.quality,
              seed,
            }
          : null;
      case "replace":
        return source && g.keys.length && (g.replacePrompt.trim() || g.replacement)
          ? {
              kind: "replace",
              model: g.models.replace === "h3-control" ? "h3-control" : "vace",
              ...engine,
              source,
              shape: g.shape,
              keys: g.keys,
              replacement: g.replacement,
              prompt: g.replacePrompt || "the replacement object",
              quality: g.quality,
              seed,
            }
          : null;
      case "paths":
        return g.still && g.paths.length
          ? { kind: "paths", model: g.models.paths === "ati" ? "ati" : "wanmove", ...engine, image: g.still, paths: g.paths, timing: g.pathTiming, prompt: g.pathPrompt, aspect: stillAspect, seed }
          : null;
    }
  }, [g, stillAspect]);

  const specKey = JSON.stringify(spec);
  useEffect(() => {
    if (!spec) return;
    // Only the latest answer counts: an older, slower one must not overwrite it.
    let current = true;
    const t = setTimeout(() => {
      api
        .preflight(spec)
        .then((r) => {
          if (!current) return;
          const m = r.meta;
          // How long a workflow takes isn't known; for ours it's estimated (Wan runs about 2.2× H3's pace).
          const eta = m && !workflowOf(g) && m.width > 0 ? formatEta(estimateSeconds(m, true) * (modelOf(g).clip === "h3" ? 1 : 2.2)) : "";
          const paid = r.paid?.length ?? 0;
          setPre({
            key: specKey,
            engine: m?.engine ?? "",
            line: m ? [m.width > 0 ? `${m.width}×${m.height}` : "", m.seconds > 0 ? `${m.seconds.toFixed(1)} s` : "", eta].filter(Boolean).join(", ") : "",
            blocker: r.blocker,
            issues: r.issues.map((i) => `${i.classType}: ${tr(i.message)}`),
            notes: m?.notes ?? [],
            cost: !paid
              ? null
              : r.price && creditsLabel(r.price)
                ? tr("API model: {usd} ({credits}) per take, billed to your Comfy account", { usd: usdLabel(r.price), credits: creditsLabel(r.price)! })
                : tr("API model: billed to your Comfy account per take"),
          });
        })
        .catch(() => current && setPre(null));
    }, 400);
    return () => {
      current = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  const go = async () => {
    if (!spec) return;
    // Only a check of these settings counts; the server checks again on submit either way.
    if (pre?.blocker && pre.key === specKey) return toast(pre.blocker, "error");
    setBusy(true);
    try {
      const [job] = await api.submit([{ ...spec, seed: randomSeed() } as JobSpec]);
      setFocus(job.id);
      toast(tr("{action} sent to the GPU.", { action: tr(mode.verb) }));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const showing = focus && KINDS.includes(focus.kind as Mode) && focus.status === "done" ? focus : null;

  return (
    <div className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_var(--nf-right)]" style={{ "--nf-right": columnWidth(panelOpen, PANEL_WIDTH) } as React.CSSProperties}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div role="tablist" aria-label={tr("Henshin mode")} className="flex gap-1 rounded-md bg-panel p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={g.mode === m.id}
                onClick={() => g.set({ mode: m.id })}
                className={clsx(
                  "rounded-[5px] px-3 py-1.5 text-[14px] transition-colors",
                  g.mode === m.id ? "bg-tungsten text-black" : "text-dim hover:text-ink",
                )}
              >
                {tr(m.label)}
              </button>
            ))}
          </div>
          <p className="max-w-[56ch] pb-1.5 text-[13px] text-dim">{tr(mode.blurb)}</p>
        </div>

        <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-[3px] bg-monitor p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
          <div className="w-full max-w-[min(100%,calc((100dvh_-_360px)*1.78))]">
            {showing ? (
              <div className="flex flex-col gap-2">
                <div className="relative" style={{ aspectRatio: `${showing.meta?.width ?? 16}/${showing.meta?.height ?? 9}` }}>
                  <TakePlayer key={showing.id} job={showing} />
                  <button onClick={() => setFocus(null)} className="absolute top-2 right-2 rounded-md bg-black/70 px-2 py-1 text-[12px] backdrop-blur hover:bg-black">
                    {tr("Back to source")}
                  </button>
                </div>
                {showing.status === "done" && <TakeActions job={showing} inline without={["graph"]} />}
              </div>
            ) : (
              <Stage />
            )}
          </div>
        </div>

        <TakeStrip kinds={KINDS} empty={tr("Transformed clips land here.")} />
      </div>

      <SidePanel
        id="henshin-settings"
        side="right"
        label="Settings"
        className="rounded-md bg-panel lg:sticky lg:top-[69px] lg:max-h-[calc(100dvh_-_81px)]"
        bodyClassName="flex flex-col gap-6 p-4 lg:overflow-y-auto"
      >
        <ModePanel caps={caps} />
        <div className="mt-auto flex flex-col gap-2 border-t border-line/60 pt-4">
          <Button variant="solid" className="py-2.5 text-[15px]" disabled={!spec || busy || (!!pre?.blocker && pre.key === specKey)} onClick={go}>
            {tr(mode.verb)}
          </Button>
          <p className="text-[12px] text-dim">
            {pre?.blocker ? (
              <span className="text-tally">{tr(pre.blocker)}</span>
            ) : spec && pre ? (
              <>
                <span className="text-ink/80">{pre.engine}</span>
                <br />
                <span className="readout text-[13px]">{pre.line}</span>
                {pre.cost && (
                  <>
                    <br />
                    <span className="text-daylight">{pre.cost}</span>
                  </>
                )}
              </>
            ) : spec ? (
              tr("Checking the graph…")
            ) : (
              tr(missingText(g))
            )}
          </p>
          {pre?.key === specKey &&
            !pre.blocker &&
            pre.notes.map((n) => (
              <p key={n} className="text-[12px] text-faint">
                {tr(n)}
              </p>
            ))}
          {pre?.issues.map((i) => (
            <p key={i} className="text-[12px] text-tally">
              {i}
            </p>
          ))}
        </div>
      </SidePanel>
    </div>
  );
}

function missingText(g: G) {
  const source = clipOf(g);
  switch (g.mode) {
    case "recast":
      return !source ? "Add a source clip." : "Add your character.";
    case "restyle":
      return !source ? "Add a source clip." : "Describe the new style or add a style image.";
    case "replace":
      return !source ? "Add a source clip." : !g.keys.length ? "Box the object to replace." : "Say what it becomes.";
    case "paths":
      return !g.still ? "Add a still image." : "Draw at least one path.";
  }
}

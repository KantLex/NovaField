"use client";

import { FastForward, X } from "lucide-react";
import { useMemo } from "react";
import { forkRig, shotPath, type CustomRig } from "@/lib/cinema/custom";
import { layerLabel, MOVES, SHOT_SIZES } from "@/lib/cinema/moves";
import { ASPECTS } from "@/lib/engines/sizing";
import { planH3 } from "@/lib/engines/sizing";
import { Monitor } from "@/ui/Monitor";
import { TakeActions } from "@/ui/TakeActions";
import { TakeStrip } from "@/ui/TakeStrip";
import { useLive, useStudio } from "@/ui/state";
import { CastShelf } from "@/ui/studio/CastShelf";
import { DirectorPanel } from "@/ui/studio/DirectorPanel";
import { PlanEditor } from "@/ui/studio/PlanEditor";
import { PromptBar } from "@/ui/studio/PromptBar";
import { useEngineOutput } from "@/ui/studio/engine";
import { recordRig } from "@/ui/studio/rigHistory";
import { columnWidth, SidePanel, usePanelKeys, usePanelOpen } from "@/ui/SidePanel";
import { tr } from "@/i18n";

// Graded clips are shots in a new look, so they sit with them.
const SHOT_KINDS = ["shot" as const, "grade" as const];

export default function StudioPage() {
  const shot = useStudio((s) => s.shot);
  const patch = useStudio((s) => s.patch);
  const focusId = useLive((s) => s.focus);
  const job = useLive((s) => (s.focus ? s.jobs[s.focus] : null));
  const setFocus = useLive((s) => s.setFocus);
  const extendJob = useLive((s) => (shot.extendFrom ? s.jobs[shot.extendFrom] : null));
  const castOpen = usePanelOpen("studio-cast");
  const directorOpen = usePanelOpen("studio-director");
  usePanelKeys({ left: "studio-cast", right: "studio-director" });

  const plan = planH3(shot.aspect, shot.quality, shot.duration);
  // An image engine makes a still, so the camera never moves; neither does a switched-off move.
  const still = useEngineOutput() === "image";
  const noMove = still || !!shot.off?.move;
  // The user's own previs clip drives MiniMax H3's camera; imported workflows have no slot for it.
  const previsClip = !noMove && !shot.engine ? shot.previs?.clip : undefined;
  const path = useMemo(
    () =>
      shotPath({
        // With the camera move switched off, the previs holds a locked-off frame.
        move: noMove ? "locked" : shot.move,
        combo: noMove ? null : shot.combo,
        size: shot.size,
        angle: shot.angle,
        lens: shot.lens,
        intensity: shot.intensity,
        rig: noMove ? null : shot.rig,
        timing: shot.timing,
        shake: noMove ? 0 : shot.shake,
        frames: plan.frames,
        fps: 24,
      }),
    [shot.move, shot.combo, shot.size, shot.angle, shot.lens, shot.intensity, shot.rig, shot.timing, shot.shake, noMove, plan.frames],
  );

  // The first drag forks the preset into a custom rig; handheld shake from the preset is kept.
  const editRig = (fn: (r: CustomRig) => CustomRig) => {
    recordRig();
    const s = useStudio.getState().shot;
    if (s.rig) return patch({ rig: fn(s.rig) });
    patch({ rig: fn(forkRig(path)), shake: Math.max(s.shake ?? 0, path.shake?.amount ?? 0) });
  };
  const move = MOVES.find((m) => m.id === shot.move);
  const size = SHOT_SIZES.find((s) => s.id === shot.size);
  const moveName = still
    ? tr("Still image")
    : previsClip
      ? tr("Your own previs clip")
      : shot.off?.move
        ? tr("Camera free")
        : shot.rig
          ? tr("Custom move")
          : shot.combo?.length
            ? layerLabel(shot.combo, tr)
            : tr(move?.label ?? "");

  return (
    <div
      className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_var(--nf-right)] xl:h-[calc(100dvh_-_57px)] xl:flex-none xl:grid-cols-[var(--nf-left)_minmax(0,1fr)_var(--nf-right-xl)] xl:grid-rows-[minmax(0,1fr)_auto] xl:overflow-hidden"
      style={{ "--nf-left": columnWidth(castOpen, "256px"), "--nf-right": columnWidth(directorOpen, "320px"), "--nf-right-xl": columnWidth(directorOpen, "336px") } as React.CSSProperties}
    >
      <SidePanel id="studio-cast" side="left" label="Cast" at="xl" place="order-2 lg:order-3 xl:order-none" className="rounded-md bg-panel xl:min-h-0" bodyClassName="p-4 xl:overflow-y-auto">
        <CastShelf />
      </SidePanel>

      <div className="order-1 flex min-h-0 flex-col gap-3 xl:order-none">
        <Monitor
          aspect={shot.aspect}
          path={path}
          still={still}
          rigStyle={shot.rigStyle === "parallax" ? "subject" : shot.rigStyle}
          job={job}
          clip={previsClip}
          readout={{ left: shot.off?.framing ? [moveName] : [moveName, `${shot.lens}mm`, tr(size?.label ?? "")], right: [shot.aspect === "2.39:1" ? tr("Scope") : shot.aspect] }}
          previs={{
            layers: shot.rig ? null : shot.combo,
            marks: shot.rig?.keys.map((k) => k.t),
            label: moveName,
            onMarkTime: (i, t) => editRig((r) => ({ ...r, keys: r.keys.map((k, j) => (j === i ? { ...k, t } : k)) })),
          }}
          plan={
            // Nothing to plan while the camera move is switched off.
            !noMove && !previsClip && <PlanEditor
              path={path}
              rig={shot.rig ?? null}
              aspect={ASPECTS.find((a) => a.id === shot.aspect)?.ratio ?? 16 / 9}
              onEdit={editRig}
              onReset={() => {
                recordRig(true);
                patch({ rig: null });
              }}
              onGrab={() => recordRig(true)}
            />
          }
        />
        {job && (
          <div className="-mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <button onClick={() => setFocus(null)} className="rounded-md bg-raised px-2.5 py-1 hover:bg-hover">
              {tr("Back to previs")}
            </button>
            <span className="min-w-0 flex-1 truncate text-dim" title={job.meta?.prompt}>
              {job.status === "failed" ? <span className="text-tally">{tr(job.error ?? "")}</span> : (job.meta?.engine ?? job.title)}
            </span>
            {focusId && <TakeActions job={job} inline />}
          </div>
        )}
        {extendJob && (
          <div className="flex items-center gap-2 rounded-md bg-tungsten/12 px-3 py-1.5 text-[13px] text-tungsten">
            <FastForward size={14} />
            <span className="min-w-0 flex-1 truncate">{tr("Continuing “{name}”: the new take starts from its last second, sound included.", { name: extendJob.title })}</span>
            <button onClick={() => patch({ extendFrom: null })} aria-label={tr("Stop continuing")} className="rounded p-0.5 hover:bg-tungsten/20">
              <X size={14} />
            </button>
          </div>
        )}
        <PromptBar />
      </div>

      <SidePanel
        id="studio-director"
        side="right"
        label="Director"
        place="order-3 lg:order-2 lg:row-span-3 xl:order-none xl:row-span-2"
        className="rounded-md bg-panel lg:sticky lg:top-[69px] lg:max-h-[calc(100dvh_-_81px)] xl:relative xl:top-auto xl:max-h-none xl:min-h-0"
        bodyClassName="p-4 lg:overflow-y-auto"
      >
        <DirectorPanel />
      </SidePanel>

      <div className="order-4 min-w-0 xl:col-span-2">
        <TakeStrip kinds={SHOT_KINDS} empty={tr("Your takes land here. Write a script and press Create.")} />
      </div>
    </div>
  );
}

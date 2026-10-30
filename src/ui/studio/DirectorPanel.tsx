"use client";

import clsx from "clsx";
import { Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { isEngine } from "@/lib/workflows/apply";
import { useRecipes } from "../workflows/store";
import { LIGHTING } from "@/lib/cinema/looks";
import { TIMINGS } from "@/lib/cinema/custom";
import { ANGLES, layerLabel, LENSES, MOVES, SHOT_SIZES } from "@/lib/cinema/moves";
import { ASPECTS, planH3, QUALITY } from "@/lib/engines/sizing";
import type { Quality } from "@/lib/engines/specs";
import { Section, Segmented, Slider, Toggle } from "../controls";
import { NodesCallout } from "../NodesCallout";
import { useLive, useStudio } from "../state";
import { EngineSource, sourceTag } from "../cost";
import { useEngineOutput } from "./engine";
import { MovePicker } from "./MovePicker";
import { PrevisSlot } from "./PrevisSlot";
import { RigFileButtons } from "./RigFileButtons";
import { tr } from "@/i18n";
import { FilmStock, sectionSwitch } from "@/ui/studio/FilmStock";

/** The model list, grouped by what each makes. The built-in MiniMax H3 is a video model. */
const OUTPUT_GROUPS = [
  { id: "video", label: "Video" },
  { id: "image", label: "Image" },
  { id: "audio", label: "Audio" },
  { id: "unknown", label: "Other" },
] as const;

const SIZE_SHORT: Record<string, string> = {
  extreme_wide: "Ext wide",
  wide: "Wide",
  full: "Full",
  medium: "Medium",
  close: "Close-up",
  extreme_close: "Ext close",
};

export function DirectorPanel() {
  const shot = useStudio((s) => s.shot);
  const patch = useStudio((s) => s.patch);
  const caps = useLive((s) => s.status?.caps);
  const rigReady = !!caps?.pack.ghostRig;
  const filmReady = !!caps?.pack.lensFilm;
  const plan = planH3(shot.aspect, shot.quality, shot.duration);
  // One object per framing, so the move tiles (each a little 3D preview) don't redraw on every edit.
  const framing = useMemo(() => ({ size: shot.size, angle: shot.angle, lens: shot.lens }), [shot.size, shot.angle, shot.lens]);
  const { list: recipes, loaded, refresh } = useRecipes();
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  const engines = recipes.filter(isEngine);
  const custom = shot.engine ? recipes.find((r) => r.id === shot.engine) : null;
  const sw = sectionSwitch(shot.off, patch);
  const still = useEngineOutput() === "image";
  const cloud = useLive((s) => s.status?.mode === "cloud");
  // A previs clip drives MiniMax H3's camera; imported workflows have no slot for it.
  const previsOn = !!shot.previs && !custom;

  return (
    <div className="flex flex-col gap-6">
      {(engines.length > 0 || custom) && (
        <Section title={tr("Model")} aside={<EngineSource paid={custom?.paid} />}>
          <select
            value={shot.engine ?? ""}
            onChange={(e) => patch({ engine: e.target.value || null })}
            className="rounded-md bg-surround px-2.5 py-2 text-[14px] focus:outline-none"
            aria-label={tr("Model")}
          >
            {OUTPUT_GROUPS.map((g) => {
              const list = engines.filter((r) => (r.output ?? "unknown") === g.id);
              if (g.id !== "video" && !list.length) return null;
              return (
                <optgroup key={g.id} label={tr(g.label)}>
                  {g.id === "video" && <option value="">{`${tr("MiniMax H3 (built in)")} · ${sourceTag([], cloud)}`}</option>}
                  {list.map((r) => (
                    <option key={r.id} value={r.id}>
                      {`${r.name} · ${sourceTag(r.paid, cloud)}`}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {(custom?.paid?.length ?? 0) > 0 && (
            <p className="text-[12px] text-daylight">
              {tr("Uses {nodes} through Comfy's API: each take costs credits, shown on the Create button.", { nodes: custom!.paid!.join(", ") })}
            </p>
          )}
          {custom &&
            (still ? (
              <p className="flex gap-2 rounded-md bg-ink/8 px-2.5 py-2 text-[12px] text-ink/85">
                <ImageIcon size={14} className="mt-px shrink-0" />
                <span>{tr("This workflow makes still images, so the video settings (camera move and duration) are hidden. Framing, light and film stock still go into its prompt.")}</span>
              </p>
            ) : (
              <p className="text-[12px] text-dim">
                {tr("Your workflow renders the shot. The script, framing, camera move, light and stock are written into its prompt; the first frame and cast go into its picture inputs.")}
              </p>
            ))}
        </Section>
      )}

      <Section title={tr("Framing")} aside={tr("Lens in mm")} enabled={sw("framing")} offNote={tr("Off: shot size, angle and lens come from your script.")}>
        <Segmented
          label={tr("Shot size")}
          size="sm"
          value={shot.size}
          onChange={(size) => patch({ size })}
          options={SHOT_SIZES.map((s) => ({
            id: s.id,
            label: SIZE_SHORT[s.id],
            title: s.label,
          }))}
        />
        <Segmented
          label={tr("Camera angle")}
          size="sm"
          value={shot.angle}
          onChange={(angle) => patch({ angle })}
          options={ANGLES.map((a) => ({ id: a.id, label: a.label }))}
        />
        <Segmented
          label={tr("Lens")}
          size="sm"
          value={shot.lens}
          onChange={(lens) => patch({ lens })}
          options={LENSES.map((l) => ({
            id: l,
            label: <span className="readout text-[14px]">{l}</span>,
            title: `${l}mm lens`,
          }))}
        />
      </Section>

      {!still && (
      <Section
        title={tr("Camera move")}
        aside={previsOn ? "Follows your previs" : rigReady ? "Rendered on the GPU" : "Described in the prompt"}
        enabled={sw("move")}
        offNote={tr("Off: no camera direction or previs. The model moves the camera as your script suggests.")}
      >
        {!custom && (
          <PrevisSlot
            previs={shot.previs}
            duration={shot.duration}
            onChange={(previs) => patch({ previs })}
            onDuration={(duration) => patch({ duration })}
          />
        )}
        {!previsOn && (
          <>
            <Toggle
              label={tr("Combine moves")}
              hint={tr("Stack up to 3 moves, at the same time or one after another")}
              checked={!!shot.combo}
              onChange={(on) =>
                on
                  ? patch({ combo: [{ id: shot.move, intensity: shot.intensity, when: "whole" }], rig: null })
                  : patch({ move: shot.combo?.[0]?.id ?? shot.move, intensity: shot.combo?.[0]?.intensity ?? shot.intensity, combo: null, rig: null })
              }
            />
            <MovePicker
              value={shot.rig ? "" : shot.move}
              combo={shot.combo ?? null}
              onPick={(move) => patch({ move, rig: null })}
              onCombo={(combo) => patch({ combo, move: combo[0]?.id ?? shot.move, rig: null })}
              framing={framing}
              intensity={shot.intensity}
              rig={shot.rig}
              onPickRig={(rig) => patch({ rig, combo: null })}
            />
            {shot.rig ? (
              <div className="flex items-center gap-2 rounded-md bg-tungsten/12 px-3 py-2 text-[12px] text-tungsten">
                <span className="flex-1">
                  {shot.rig.name
                    ? tr("“{name}”, a custom move. Edit it in the monitor's Plan view.", { name: shot.rig.name })
                    : tr("Custom move from {move}. Edit it in the monitor's Plan view.", {
                        move: shot.combo?.length ? layerLabel(shot.combo, tr) : tr(MOVES.find((m) => m.id === shot.move)?.label ?? "a preset"),
                      })}
                </span>
                <button onClick={() => patch({ rig: null })} className="rounded px-1.5 py-0.5 hover:bg-tungsten/20">
                  {tr("Reset")}
                </button>
              </div>
            ) : shot.combo ? null : (
              <>
                <Slider
                  label={tr("Intensity")}
                  value={shot.intensity}
                  min={0.3}
                  max={1.6}
                  step={0.05}
                  onChange={(intensity) => patch({ intensity })}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
                <p className="-mt-1 text-[12px] text-faint">{tr("To shape the move yourself, drag it in the monitor's Plan view.")}</p>
              </>
            )}
            <Segmented label={tr("Timing")} size="sm" value={shot.timing ?? "auto"} onChange={(timing) => patch({ timing })} options={TIMINGS} />
            <Slider
              label={tr("Handheld")}
              value={shot.shake ?? 0}
              min={0}
              max={1}
              step={0.05}
              onChange={(shake) => patch({ shake })}
              format={(v) => (v === 0 ? tr("Off") : `${Math.round(v * 100)}%`)}
            />
            <RigFileButtons />
            {!custom && (
              <Toggle
                label={tr("Previs")}
                hint={rigReady ? "Renders this move as a wireframe guide video and makes H3 follow it" : "Makes H3 follow this exact move with a wireframe guide video"}
                checked={shot.cameraMode === "rig" && rigReady}
                disabled={!rigReady}
                onChange={(on) => patch({ cameraMode: on ? "rig" : "prompt" })}
              />
            )}
            {!custom && !rigReady && <NodesCallout feature={tr("Previs")} />}
            {!custom && shot.cameraMode === "rig" && rigReady && (
              <Segmented
                label={tr("Rig scene")}
                size="sm"
                value={shot.rigStyle}
                onChange={(rigStyle) => patch({ rigStyle })}
                options={[
                  {
                    id: "subject",
                    label: "Figure",
                    title: "Grid floor, pillars and a stand-in figure",
                  },
                  {
                    id: "stage",
                    label: "Empty set",
                    title: "Grid floor and pillars",
                  },
                  {
                    id: "starfield",
                    label: "Stars",
                    title: "Points in space, for aerial and FPV moves",
                  },
                  {
                    id: "parallax",
                    label: "Photo 2.5D",
                    title: "Moves through your first frame in depth",
                    disabled: !shot.startFrame,
                  },
                ]}
              />
            )}
          </>
        )}
      </Section>

      )}

      <Section title={tr("Light")} enabled={sw("light")} offNote={tr("Off: the light comes from your script.")}>
        <div className="flex flex-wrap gap-1.5">
          {LIGHTING.map((l) => (
            <button
              key={l.id}
              onClick={() => patch({ lighting: l.id })}
              aria-pressed={shot.lighting === l.id}
              className={clsx(
                "rounded-full px-2.5 py-1 text-[12px] transition-colors",
                shot.lighting === l.id ? "bg-ink text-surround" : "bg-surround text-dim hover:text-ink",
              )}
            >
              {tr(l.label)}
            </button>
          ))}
        </div>
      </Section>

      <FilmStock filmReady={filmReady} enabled={sw("film")} />

      <Section title={tr("Format")} aside={custom ? "Size follows your workflow" : `${plan.width}×${plan.height}, ${plan.frames} frames`}>
        <Segmented
          label={tr("Aspect ratio")}
          size="sm"
          value={shot.aspect}
          onChange={(aspect) => patch({ aspect })}
          options={ASPECTS.map((a) => ({ id: a.id, label: a.label }))}
        />
        {!custom && (
          <Segmented<Quality>
            label={tr("Quality")}
            value={shot.quality}
            onChange={(quality) => patch({ quality })}
            options={(Object.keys(QUALITY) as Quality[]).map((q) => ({
              id: q,
              label: QUALITY[q].label,
              title: QUALITY[q].note,
            }))}
          />
        )}
        {!still && <Slider label={tr("Duration")} value={shot.duration} min={2} max={15} step={0.5} onChange={(duration) => patch({ duration })} format={(v) => `${v}s`} />}
        {!custom && plan.clamped && (
          <p className="text-[12px] text-tungsten">Master renders stop at {plan.seconds.toFixed(1)} s: MiniMax H3 breaks down past that at 1080p.</p>
        )}
        {!custom && (
          <div className="flex flex-col">
            <Toggle label={tr("Turbo")} hint={tr("8 steps instead of 20, about 2.5× faster")} checked={shot.turbo} onChange={(turbo) => patch({ turbo })} />
            <Toggle label={tr("Sound")} hint={tr("H3 generates synchronised audio")} checked={shot.sound} onChange={(sound) => patch({ sound })} />
            <Toggle
              label={tr("Smooth 48 fps")}
              hint={caps?.interpolate === false ? "Needs FILM interpolation on the server" : "Doubles the frame rate with FILM"}
              checked={shot.smooth}
              disabled={caps?.interpolate === false}
              onChange={(smooth) => patch({ smooth })}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

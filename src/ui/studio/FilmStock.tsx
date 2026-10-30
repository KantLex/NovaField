"use client";

// The film-stock section of the Director panel, and the on/off switch each section carries.

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { LOOKS } from "@/lib/cinema/looks";
import type { ShotSection } from "@/lib/engines/specs";
import { Section, Slider, Toggle } from "../controls";
import { NodesCallout } from "../NodesCallout";
import { useStudio } from "../state";
import { tr } from "@/i18n";

/** The on/off switch for a panel section; off sections stay out of the shot. */
export function sectionSwitch(off: Partial<Record<ShotSection, boolean>> | undefined, patch: (p: { off: Partial<Record<ShotSection, boolean>> }) => void) {
  return (key: ShotSection) => ({ on: !off?.[key], onChange: (on: boolean) => patch({ off: { ...off, [key]: !on } }) });
}

export function FilmStock({ filmReady, enabled }: { filmReady: boolean; enabled: { on: boolean; onChange: (on: boolean) => void } }) {
  const shot = useStudio((s) => s.shot);
  const patch = useStudio((s) => s.patch);
  const [open, setOpen] = useState(false);
  const f = shot.film;
  const setFilm = (p: Partial<typeof f>) => patch({ film: { ...f, ...p } });

  return (
    <Section
      title={tr("Film stock")}
      aside={filmReady && shot.filmOnGpu ? "Graded on the GPU" : "Described in the prompt"}
      enabled={enabled}
      offNote={tr("Off: no stock in the prompt and no grade on the GPU.")}
    >
      <div className="grid grid-cols-3 gap-1.5">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            onClick={() =>
              setFilm({
                look: l.id,
                grain: l.grain,
                halation: l.halation,
                vignette: l.vignette,
              })
            }
            aria-pressed={f.look === l.id}
            title={l.note}
            className={clsx(
              "flex flex-col gap-1 rounded-[5px] p-1 text-left transition-shadow",
              f.look === l.id ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]",
            )}
          >
            <span className="flex h-5 overflow-hidden rounded-[3px]">
              {l.swatch.map((c) => (
                <span key={c} className="flex-1" style={{ background: c }} />
              ))}
            </span>
            <span className="truncate text-[12px] text-dim">{tr(l.label)}</span>
          </button>
        ))}
      </div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 self-start text-[12px] text-dim hover:text-ink" aria-expanded={open}>
        <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} />
        {tr("Film lab")}
      </button>
      {open &&
        (filmReady ? (
          <div className="flex flex-col gap-2">
            <Toggle label={tr("Grade on the GPU")} hint={tr("NovaLensFilm runs after decoding")} checked={shot.filmOnGpu} onChange={(filmOnGpu) => patch({ filmOnGpu })} />
            <Slider label={tr("Strength")} value={f.intensity} min={0} max={1} step={0.05} onChange={(intensity) => setFilm({ intensity })} format={pct} />
            <Slider label={tr("Grain")} value={f.grain} min={0} max={1} step={0.05} onChange={(grain) => setFilm({ grain })} format={pct} />
            <Slider label={tr("Halation")} value={f.halation} min={0} max={1} step={0.05} onChange={(halation) => setFilm({ halation })} format={pct} />
            <Slider label={tr("Vignette")} value={f.vignette} min={0} max={1} step={0.05} onChange={(vignette) => setFilm({ vignette })} format={pct} />
            <Slider label={tr("Fringing")} value={f.chromatic} min={0} max={1} step={0.05} onChange={(chromatic) => setFilm({ chromatic })} format={pct} />
            <Slider label={tr("Gate weave")} value={f.gateWeave} min={0} max={1} step={0.05} onChange={(gateWeave) => setFilm({ gateWeave })} format={pct} />
            <Slider label={tr("Anamorphic")} value={f.streak} min={0} max={1} step={0.05} onChange={(streak) => setFilm({ streak })} format={pct} />
          </div>
        ) : (
          <NodesCallout feature={tr("The film lab (grain, halation, gate weave and the rest)")} />
        ))}
    </Section>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

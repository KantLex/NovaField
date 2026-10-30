"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { shotPath, type CustomRig } from "@/lib/cinema/custom";
import { buildPath, CATEGORIES, MOVES, type Framing, type MoveCategory, type MoveLayer } from "@/lib/cinema/moves";
import { RigView } from "../RigView";
import { useStudio, type SavedMove } from "../state";
import { tr } from "@/i18n";
import { useReveal } from "../reveal";

const MAX_LAYERS = 3;
const WHEN: { id: MoveLayer["when"]; label: string; title: string }[] = [
  { id: "whole", label: "Whole shot", title: "Plays across the whole shot" },
  { id: "start", label: "First half", title: "Plays in the first half" },
  { id: "end", label: "Then", title: "Plays in the second half, after the others" },
];

/**
 * Every camera move as a tiny live previs, filtered by category. In combine mode tiles stack
 * as numbered layers (up to three), each with its own timing and strength.
 */
export function MovePicker({
  value,
  combo,
  onPick,
  onCombo,
  framing,
  intensity,
  rig,
  onPickRig,
}: {
  value: string;
  combo: MoveLayer[] | null;
  onPick: (id: string) => void;
  onCombo: (layers: MoveLayer[]) => void;
  framing: Framing;
  intensity: number;
  /** The custom rig in use, to mark a saved move as chosen. */
  rig?: CustomRig | null;
  onPickRig: (rig: CustomRig) => void;
}) {
  const saved = useStudio((s) => s.savedMoves);
  const removeMove = useStudio((s) => s.removeMove);
  const current = MOVES.find((m) => m.id === (combo?.[0]?.id ?? value));
  const [category, setCategory] = useState<MoveCategory | "all" | "saved">(current?.category ?? "dolly");
  const reveal = useReveal(category);
  const shown = category === "all" ? MOVES : MOVES.filter((m) => m.category === category);
  const chips = [{ id: "all" as const, label: "All" }, ...CATEGORIES, ...(saved.length ? [{ id: "saved" as const, label: `${tr("Saved")} ${saved.length}` }] : [])];
  const combining = !!combo;
  // Categories holding the chosen move(s), marked so a selection on another tab isn't lost.
  const chosen = new Set((combo ? combo.map((l) => l.id) : [value]).map((id) => MOVES.find((m) => m.id === id)?.category));

  const toggle = (id: string) => {
    if (!combo) return onPick(id);
    const i = combo.findIndex((l) => l.id === id);
    if (i >= 0) {
      if (combo.length > 1) onCombo(combo.filter((_, j) => j !== i));
      return;
    }
    if (combo.length >= MAX_LAYERS) return;
    onCombo([...combo, { id, intensity: 1, when: "whole" }]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" aria-label={tr("Move categories")} className="flex flex-wrap gap-1">
        {chips.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            onClick={() => setCategory(c.id)}
            className={clsx(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] whitespace-nowrap transition-colors",
              category === c.id ? "bg-tungsten text-black" : "bg-surround text-dim hover:text-ink",
            )}
          >
            {tr(c.label)}
            {c.id !== "all" && c.id !== "saved" && category !== c.id && chosen.has(c.id) && <span className="size-1.5 rounded-full bg-tungsten" aria-label={tr("has your move")} />}
          </button>
        ))}
      </div>

      {category === "saved" ? (
        <div role="radiogroup" aria-label={tr("Saved moves")} className="grid grid-cols-3 gap-1.5">
          {saved.map((m) => (
            <SavedTile key={m.id} move={m} active={rig === m.rig} framing={framing} onPick={() => onPickRig(m.rig)} onRemove={() => removeMove(m.id)} />
          ))}
        </div>
      ) : (
      <div key={reveal.key} role={combining ? "group" : "radiogroup"} aria-label={tr("Camera move")} className={clsx("grid grid-cols-3 gap-1.5", reveal.className)}>
        {shown.map((m) => {
          const layer = combo?.findIndex((l) => l.id === m.id) ?? -1;
          const active = combining ? layer >= 0 : m.id === value;
          return (
            <MoveTile
              key={m.id}
              id={m.id}
              label={tr(m.label)}
              hint={tr(m.hint)}
              active={active}
              badge={combining && layer >= 0 ? layer + 1 : null}
              disabled={combining && layer < 0 && (combo?.length ?? 0) >= MAX_LAYERS}
              onPick={() => toggle(m.id)}
              framing={framing}
              intensity={intensity}
            />
          );
        })}
      </div>
      )}

      {combining && combo && category !== "saved" && (
        <ol className="flex flex-col gap-1.5" aria-label={tr("Stacked moves")}>
          {combo.map((l, i) => {
            const m = MOVES.find((x) => x.id === l.id);
            const set = (p: Partial<MoveLayer>) => onCombo(combo.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <li key={l.id} className="flex flex-col gap-1.5 rounded-md bg-surround px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="readout flex size-5 items-center justify-center rounded-full bg-tungsten text-[12px] text-black">{i + 1}</span>
                  <span className="flex-1 text-[13px]">{tr(m?.label ?? l.id)}</span>
                  {combo.length > 1 && (
                    <button onClick={() => onCombo(combo.filter((_, j) => j !== i))} className="rounded p-0.5 text-dim hover:text-ink" aria-label={tr("Remove {name}", { name: tr(m?.label ?? "") })}>
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-0.5 rounded-md bg-panel p-0.5" role="radiogroup" aria-label={tr("When {name} plays", { name: tr(m?.label ?? "") })}>
                    {WHEN.map((w) => (
                      <button
                        key={w.id}
                        role="radio"
                        aria-checked={l.when === w.id}
                        title={tr(w.title)}
                        onClick={() => set({ when: w.id })}
                        className={clsx("rounded px-2 py-0.5 text-[11px]", l.when === w.id ? "bg-raised text-ink" : "text-dim hover:text-ink")}
                      >
                        {tr(w.label)}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0.3}
                    max={1.6}
                    step={0.05}
                    value={l.intensity}
                    onChange={(e) => set({ intensity: Number(e.target.value) })}
                    className="h-1 min-w-16 flex-1"
                    aria-label={tr("{name} strength", { name: tr(m?.label ?? "") })}
                  />
                  <span className="readout w-9 text-right text-[13px] text-ink/85">{Math.round(l.intensity * 100)}%</span>
                </div>
              </li>
            );
          })}
          {combo.length < MAX_LAYERS && <li className="px-1 text-[12px] text-faint">{tr("Tap another move to stack it ({n} more).", { n: MAX_LAYERS - combo.length })}</li>}
        </ol>
      )}
    </div>
  );
}

function MoveTile({
  id,
  label,
  hint,
  active,
  badge,
  disabled,
  onPick,
  framing,
  intensity,
}: {
  id: string;
  label: string;
  hint: string;
  active: boolean;
  badge: number | null;
  disabled: boolean;
  onPick: () => void;
  framing: Framing;
  intensity: number;
}) {
  const [hover, setHover] = useState(false);
  const path = useMemo(() => buildPath(id, { ...framing, intensity, frames: 72, fps: 24 }), [id, framing, intensity]);
  return (
    <button
      aria-pressed={active}
      title={hint}
      onClick={onPick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={clsx(
        "group relative flex flex-col overflow-hidden rounded-[5px] bg-surround text-left transition-shadow disabled:cursor-not-allowed disabled:opacity-35",
        active ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]",
      )}
    >
      <RigView path={path} style="subject" playing={hover || active} className="aspect-video w-full" />
      {badge !== null && <span className="readout absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-tungsten text-[11px] text-black">{badge}</span>}
      <span className={clsx("px-1.5 py-1 text-[12px] leading-tight", active ? "text-ink" : "text-dim group-hover:text-ink")}>{label}</span>
    </button>
  );
}

/** A move shaped in the Plan view and saved by name: picking it loads the whole plan back. */
function SavedTile({ move, active, framing, onPick, onRemove }: { move: SavedMove; active: boolean; framing: Framing; onPick: () => void; onRemove: () => void }) {
  const [hover, setHover] = useState(false);
  const path = useMemo(() => shotPath({ ...framing, move: "locked", intensity: 1, frames: 72, fps: 24, rig: move.rig }), [move.rig, framing]);
  return (
    <div className="group relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        role="radio"
        aria-checked={active}
        onClick={onPick}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={clsx(
          "flex w-full flex-col overflow-hidden rounded-[5px] bg-surround text-left transition-shadow",
          active ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]",
        )}
      >
        <RigView path={path} style="subject" playing={hover || active} className="aspect-video w-full" />
        <span className={clsx("truncate px-1.5 py-1 text-[12px] leading-tight", active ? "text-ink" : "text-dim group-hover:text-ink")}>{move.name}</span>
      </button>
      <button
        onClick={() => confirm(tr("Delete the saved move “{name}”?", { name: move.name })) && onRemove()}
        className="absolute top-1 right-1 rounded bg-black/60 p-0.5 text-ink/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus:opacity-100"
        aria-label={tr("Delete {name}", { name: move.name })}
      >
        <X size={12} />
      </button>
    </div>
  );
}

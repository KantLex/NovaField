"use client";

import clsx from "clsx";
import { tr } from "@/i18n";
import { motion } from "motion/react";
import { useId } from "react";

export function Section({
  title,
  aside,
  children,
  className,
  enabled,
  offNote,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Gives the section an on/off switch; off folds it away. */
  enabled?: { on: boolean; onChange: (on: boolean) => void };
  /** What "off" means, shown in place of the controls. */
  offNote?: string;
}) {
  const off = enabled && !enabled.on;
  return (
    <section className={clsx("flex flex-col gap-2.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={clsx("text-[13px] font-semibold", off ? "text-faint" : "text-dim")}>{tr(title)}</h3>
        <div className="flex items-center gap-2.5">
          {aside && !off && <div className="text-[12px] text-faint">{typeof aside === "string" ? tr(aside) : aside}</div>}
          {enabled && (
            <button
              role="switch"
              aria-checked={enabled.on}
              aria-label={`${tr(title)}: ${tr(enabled.on ? "on" : "off")}`}
              title={tr(enabled.on ? "Switch it off and leave it to the prompt" : "Switch it back on")}
              onClick={() => enabled.onChange(!enabled.on)}
              className={clsx("relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors", enabled.on ? "bg-tungsten" : "bg-raised shadow-[inset_0_0_0_1px_var(--color-line)]")}
            >
              <span className={clsx("absolute top-[3px] size-3 rounded-full transition-[left,background-color]", enabled.on ? "left-[15px] bg-black" : "left-[3px] bg-dim")} />
            </button>
          )}
        </div>
      </div>
      {off ? offNote && <p className="-mt-1 text-[12px] text-faint">{tr(offNote)}</p> : children}
    </section>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
  label,
}: {
  value: T;
  options: { id: T; label: React.ReactNode; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  label: string;
}) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={tr(label)} className="flex flex-wrap gap-1 rounded-md bg-surround/70 p-1">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={String(o.id)}
            role="radio"
            aria-checked={active}
            title={o.title && tr(o.title)}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={clsx(
              "relative flex-1 rounded-[5px] px-2 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-35",
              size === "sm" ? "py-1 text-[12px]" : "py-1.5 text-[13px]",
              active ? "text-ink" : "text-dim hover:text-ink",
            )}
          >
            {active && <motion.span layoutId={`seg-${group}`} className="absolute inset-0 rounded-[5px] bg-raised shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]" transition={{ type: "spring", bounce: 0.15, duration: 0.35 }} />}
            <span className="relative">{typeof o.label === "string" ? tr(o.label) : o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-[74px] shrink-0 text-[13px] text-dim">
        {tr(label)}
      </label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 min-w-0 flex-1" />
      <span className="readout w-11 text-right text-[14px] text-ink/85">{format ? format(value) : value}</span>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={clsx("flex cursor-pointer items-start gap-3 py-1", disabled && "cursor-not-allowed opacity-45")}>
      <span className="relative mt-0.5 inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-[18px] w-8 rounded-full bg-surround transition-colors peer-checked:bg-tungsten-deep peer-focus-visible:outline-2 peer-focus-visible:outline-tungsten" />
        <span className="absolute top-[3px] left-[3px] size-3 rounded-full bg-dim transition-all peer-checked:left-[17px] peer-checked:bg-ink" />
      </span>
      <span className="flex flex-col">
        <span className="text-[13px]">{tr(label)}</span>
        {hint && <span className="text-[12px] text-faint">{tr(hint)}</span>}
      </span>
    </label>
  );
}

export function Button({
  children,
  variant = "quiet",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "quiet" | "solid" | "daylight" | "danger" }) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-[color,background-color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40",
        variant === "quiet" && "bg-raised text-ink hover:bg-hover",
        variant === "solid" && "bg-tungsten font-semibold text-black hover:bg-[#efff6b]",
        variant === "daylight" && "bg-daylight font-semibold text-black hover:bg-[#fbffcc]",
        variant === "danger" && "bg-raised text-tally hover:bg-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Locked({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-3 py-2 text-[12px] text-dim">{children}</p>;
}

/**
 * A small icon-only button with a tooltip. `label` is English and translated here. "panel" sits in
 * toolbars and panels; "overlay" sits on pictures and video. `active` marks a toggle that's on.
 */
export function IconButton({
  label,
  onClick,
  disabled,
  active,
  tone = "panel",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  tone?: "panel" | "overlay";
  children: React.ReactNode;
}) {
  const text = tr(label);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={text}
      aria-label={text}
      aria-pressed={active}
      className={clsx(
        "transition-colors disabled:opacity-30",
        tone === "overlay"
          ? "rounded bg-black/60 p-1 text-ink/85 hover:text-tungsten"
          : clsx("rounded-md p-1.5 disabled:hover:bg-transparent", active ? "bg-raised text-ink" : "text-dim hover:bg-raised hover:text-ink"),
      )}
    >
      {children}
    </button>
  );
}


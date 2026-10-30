"use client";

// Side panels that fold away to a thin rail, so the picture gets the room. Each page remembers
// which of its panels are folded; [ and ] fold the left and right panel from the keyboard.

import clsx from "clsx";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useHotkeys } from "./hotkeys";
import { tr } from "@/i18n";

export const usePanels = create<{ closed: Record<string, boolean>; toggle: (id: string) => void }>()(
  persist(
    (set) => ({
      closed: {},
      toggle: (id) => set((s) => ({ closed: { ...s.closed, [id]: !s.closed[id] } })),
    }),
    { name: "novafield-panels", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ closed: s.closed }) as never },
  ),
);

/** Whether a panel is open (they all start open). */
export const usePanelOpen = (id: string) => usePanels((s) => !s.closed[id]);

/** Width of a panel's grid column: its own width open, the rail's folded. */
export const RAIL = "40px";
export const columnWidth = (open: boolean, width: string) => (open ? width : RAIL);

/** [ folds the page's left panel, ] its right one. */
export function usePanelKeys({ left, right }: { left?: string; right?: string }) {
  const toggle = usePanels((s) => s.toggle);
  useHotkeys((e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const id = e.key === "[" ? left : e.key === "]" ? right : undefined;
    if (!id) return;
    e.preventDefault();
    toggle(id);
  });
}

// Literal class names per breakpoint, so Tailwind sees them.
const RAIL_AT = {
  lg: "lg:sticky lg:top-[69px] lg:h-[calc(100dvh_-_81px)] lg:w-10 lg:flex-col lg:justify-start lg:px-0 lg:py-3",
  xl: "xl:h-auto xl:w-10 xl:flex-col xl:justify-start xl:px-0 xl:py-3",
} as const;
const LABEL_AT = { lg: "lg:[writing-mode:vertical-rl]", xl: "xl:[writing-mode:vertical-rl]" } as const;

/**
 * A page's side panel. Open, it's the panel with a fold handle on its inner edge; folded, a rail
 * with its name that opens it again. `place` holds the grid placement both share (order, row span),
 * `className` the panel's frame (background, sticking, height) and `bodyClassName` its scrolling
 * contents: the handle sits outside the frame, where a scrolling box would clip it. From `at` up
 * the rail stands upright beside the page; below it, it's a bar.
 */
export function SidePanel({
  id,
  side,
  label,
  place,
  className,
  bodyClassName,
  at = "lg",
  children,
  ...rest
}: {
  id: string;
  side: "left" | "right";
  label: string;
  place?: string;
  className?: string;
  bodyClassName?: string;
  at?: "lg" | "xl";
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  const open = usePanelOpen(id);
  const toggle = usePanels((s) => s.toggle);
  const keyHint = side === "left" ? "[" : "]";

  if (!open) {
    const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
    return (
      <button
        onClick={() => toggle(id)}
        aria-expanded={false}
        title={`${tr("Show {name}", { name: tr(label) })} (${keyHint})`}
        className={clsx(
          place,
          "flex items-center justify-center gap-2 rounded-md bg-panel px-3 py-2 text-[13px] text-dim transition-colors hover:bg-raised hover:text-ink",
          RAIL_AT[at],
        )}
      >
        <Icon size={16} className="shrink-0" />
        <span className={LABEL_AT[at]}>{tr(label)}</span>
      </button>
    );
  }

  const Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  return (
    <aside {...rest} className={clsx("relative flex flex-col", place, className)}>
      <button
        onClick={() => toggle(id)}
        aria-expanded
        aria-label={tr("Hide {name}", { name: tr(label) })}
        title={`${tr("Hide {name}", { name: tr(label) })} (${keyHint})`}
        className={clsx(
          // On the panel's inner edge, over the gap, where it never covers the panel's own controls.
          "absolute top-3 z-20 hidden size-6 items-center justify-center rounded-full bg-raised text-dim shadow-[0_0_0_1px_var(--color-line)] transition-colors hover:bg-hover hover:text-ink",
          at === "xl" ? "xl:flex" : "lg:flex",
          side === "left" ? "-right-3" : "-left-3",
        )}
      >
        <Icon size={13} />
      </button>
      <div className={clsx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </aside>
  );
}

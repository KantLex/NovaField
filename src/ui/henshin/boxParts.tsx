"use client";

// The box tracker's pieces: the box and its resize handles, the mask preview, and the tool buttons.

import clsx from "clsx";
import type { BoxKey } from "@/lib/engines/specs";
import { clampBox } from "@/lib/engines/tracks";

export type Box = Omit<BoxKey, "f">;

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: { id: Handle; x: number; y: number; cursor: string }[] = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
];

/** A box after dragging one of its handles by (dx, dy). */
export function resize(b: Box, h: Handle, dx: number, dy: number): Box {
  let { x, y, w, h: ht } = b;
  if (h.includes("w")) [x, w] = [x + dx, w - dx];
  if (h.includes("e")) w += dx;
  if (h.includes("n")) [y, ht] = [y + dy, ht - dy];
  if (h.includes("s")) ht += dy;
  // Dragging past the opposite edge flips the box rather than turning it inside out.
  if (w < 0) [x, w] = [x + w, -w];
  if (ht < 0) [y, ht] = [y + ht, -ht];
  return clampBox({ x, y, w, h: ht });
}

/** Darkens what the GPU keeps, so the repainted area (box + margin + soft edge) shows as it will be used. */
export function MaskView({ box, shape, expand, feather }: { box: Box; shape: "rect" | "ellipse"; expand: number; feather: number }) {
  const w = box.w * (1 + 2 * expand);
  const h = box.h * (1 + 2 * expand);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // The soft edge lies outside the margin; a blur of about half its width reads the same.
  const blur = `${Math.max(0.01, feather * w * 1000 * 0.5)} ${Math.max(0.01, feather * h * 1000 * 0.5)}`;
  const grow = 1 + feather;
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
      <defs>
        <filter id="nf-mask-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        <mask id="nf-mask-keep">
          <rect width="1000" height="1000" fill="white" />
          {shape === "ellipse" ? (
            <ellipse cx={cx * 1000} cy={cy * 1000} rx={(w / 2) * grow * 1000} ry={(h / 2) * grow * 1000} fill="black" filter="url(#nf-mask-soft)" />
          ) : (
            <rect x={(cx - (w / 2) * grow) * 1000} y={(cy - (h / 2) * grow) * 1000} width={w * grow * 1000} height={h * grow * 1000} fill="black" filter="url(#nf-mask-soft)" />
          )}
        </mask>
      </defs>
      <rect width="1000" height="1000" fill="black" opacity={0.62} mask="url(#nf-mask-keep)" />
      {shape === "ellipse" ? (
        <ellipse cx={cx * 1000} cy={cy * 1000} rx={(w / 2) * 1000} ry={(h / 2) * 1000} fill="none" stroke="white" strokeOpacity={0.5} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ) : (
        <rect x={(cx - w / 2) * 1000} y={(cy - h / 2) * 1000} width={w * 1000} height={h * 1000} fill="none" stroke="white" strokeOpacity={0.5} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

export function ToolButton({
  onClick,
  disabled,
  pressed,
  danger,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={clsx(
        "flex items-center gap-1 rounded px-2 py-1 disabled:opacity-30",
        pressed ? "bg-tungsten/20 text-ink" : "text-dim hover:bg-raised hover:text-ink",
        danger && "hover:text-tally",
      )}
    >
      {children}
    </button>
  );
}

// The asset library: characters, objects, locations, styles and clips registered once and reused
// across Studio, Henshin and workflows. Shared by the server store and the browser.

import type { Asset } from "./engines/specs";

export type AssetKind = "character" | "object" | "location" | "style" | "clip";

export const ASSET_KINDS: { id: AssetKind; label: string; plural: string; hint: string }[] = [
  { id: "character", label: "Character", plural: "Characters", hint: "A person or creature, from several angles: one click puts every picture in the cast." },
  { id: "object", label: "Object", plural: "Objects", hint: "A product, prop or vehicle that has to look the same in every shot." },
  { id: "location", label: "Location", plural: "Locations", hint: "A set or place: wide shots, details, first frames." },
  { id: "style", label: "Style", plural: "Styles", hint: "Look references: grades, art direction, mood frames." },
  { id: "clip", label: "Clip", plural: "Clips", hint: "Footage to recast, restyle, continue or drive a workflow." },
];

/** What an upload is for; "track" is music for a film, kept here and never sent to ComfyUI. */
export type Purpose = "image" | "h3" | "wan" | "raw" | "track";

export interface AssetItem {
  id: string;
  kind: "image" | "video" | "audio";
  /** File name of the original in data/assets. */
  file: string;
  /** Browser URL of the original. */
  url: string;
  /** Still for videos (and the image itself for pictures). */
  poster?: string;
  width?: number;
  height?: number;
  duration?: number;
  /** "front", "side", "smiling"… */
  label?: string;
  /** The ComfyUI-ready copy for each purpose, made the first time it's used that way. */
  uses?: Partial<Record<Purpose, Asset>>;
}

export interface AssetEntry {
  id: string;
  name: string;
  kind: AssetKind;
  /** What a model should know that the pictures don't say: age, wardrobe, material, mood. */
  description: string;
  items: AssetItem[];
  /** Item shown on the card. */
  cover?: string;
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** The @name used in scripts: the name without spaces, at most 16 characters. */
export const handleOf = (name: string) => name.replace(/[^\p{L}\p{N}_-]+/gu, "").slice(0, 16) || "Asset";

export const coverOf = (e: AssetEntry) => e.items.find((i) => i.id === e.cover) ?? e.items.find((i) => i.kind === "image") ?? e.items[0];

type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** "4 images · 1 video". `t` translates for display. */
export function countLabel(e: AssetEntry, t: Translate = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k])) : s)): string {
  const n = (k: AssetItem["kind"]) => e.items.filter((i) => i.kind === k).length;
  const parts = (
    [
      [n("image"), "1 image", "{n} images"],
      [n("video"), "1 video", "{n} videos"],
      [n("audio"), "1 audio clip", "{n} audio clips"],
    ] as const
  )
    .filter(([c]) => c > 0)
    .map(([c, one, many]) => (c === 1 ? t(one) : t(many, { n: c })));
  return parts.join(" · ") || t("Empty");
}

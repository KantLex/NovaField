// The command line's small languages: how a picture, a clip, a box, a motion path, a workflow value
// or an edit clip is written as one argument. Pure, so they're tested on their own (cliArgs.test.ts).

import type { Clip } from "@/lib/sequence";
import type { PathTiming } from "@/lib/engines/specs";
import type { FrameMove } from "@/lib/engines/tracks";
import type { BoxAt, PathInput } from "./henshin";

/**
 * Where a picture or clip comes from:
 *   asset:ID        a library asset          take:ID[@seconds]  a take (a frame of it, for pictures)
 *   ./file.png      a local file             ID                 a take or an asset, whichever has that id
 */
export type Ref = { from: "asset"; id: string } | { from: "take"; id: string; at?: number } | { from: "file"; path: string } | { from: "id"; id: string; at?: number };

const ID = /^[0-9a-f]{8}$/i;

function idAt(s: string, what: string): { id: string; at?: number } {
  const [id, at] = s.split("@");
  if (!id) throw new Error(`${what}: which id?`);
  if (at === undefined) return { id };
  const t = Number(at);
  if (!Number.isFinite(t) || t < 0) throw new Error(`${what}: "@${at}" should be seconds into the take, e.g. ${id}@2.5`);
  return { id, at: t };
}

export function parseRef(s: string): Ref {
  const v = s.trim();
  if (!v) throw new Error("An empty picture or clip.");
  if (v.startsWith("asset:")) return { from: "asset", id: v.slice(6) };
  if (v.startsWith("take:")) return { from: "take", ...idAt(v.slice(5), v) };
  if (v.startsWith("file:")) return { from: "file", path: v.slice(5) };
  const [bare, at] = v.split("@");
  // "abcd1234@2x.png" is a file that happens to start like an id, not a take at "2x.png" seconds.
  if (ID.test(bare) && (at === undefined || /^[\d.]+$/.test(at))) return { from: "id", ...idAt(v, v) };
  return { from: "file", path: v };
}

const unitNumber = (s: string, what: string) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${what}: "${s}" should be a fraction from 0 to 1.`);
  return n;
};

/** "x,y,w,h" or "x,y,w,h@seconds": a box in 0–1 frame coordinates, top-left corner first. */
export function parseBox(s: string): BoxAt {
  const [box, at] = s.split("@");
  const parts = box.split(",").map((p) => p.trim());
  if (parts.length !== 4) throw new Error(`Box "${s}": write it as x,y,w,h (fractions of the frame), e.g. 0.4,0.3,0.2,0.4@1.5`);
  const [x, y, w, h] = parts.map((p) => unitNumber(p, `Box "${s}"`));
  const out: BoxAt = { x, y, w, h };
  if (at !== undefined) {
    const t = Number(at);
    if (!Number.isFinite(t) || t < 0) throw new Error(`Box "${s}": "@${at}" should be seconds into the clip.`);
    out.at = t;
  }
  return out;
}

const EASES: PathTiming["ease"][] = ["smooth", "linear", "in", "out"];

/**
 * "x,y x,y …" points in 0–1 picture coordinates (one point pins a thing still), then optionally
 * "@start-end" (when it moves, as fractions of the clip) and ":ease". E.g. "0.2,0.6 0.7,0.5@0.1-0.8:out".
 */
export function parsePath(s: string): PathInput {
  const m = /^([^@:]+)(?:@([\d.]+)-([\d.]+))?(?::(\w+))?$/.exec(s.trim());
  if (!m) throw new Error(`Path "${s}": write points as "x,y x,y", then optionally @start-end and :ease, e.g. "0.2,0.6 0.7,0.5@0.1-0.8:out"`);
  const points = m[1]
    .trim()
    .split(/[\s;]+/)
    .map((p) => {
      const xy = p.split(",");
      if (xy.length !== 2) throw new Error(`Path "${s}": "${p}" should be x,y.`);
      return [unitNumber(xy[0], `Path "${s}"`), unitNumber(xy[1], `Path "${s}"`)] as [number, number];
    });
  const out: PathInput = { points };
  if (m[2] !== undefined) {
    out.start = unitNumber(m[2], `Path "${s}"`);
    out.end = unitNumber(m[3], `Path "${s}"`);
  }
  if (m[4] !== undefined) {
    if (!EASES.includes(m[4] as PathTiming["ease"])) throw new Error(`Path "${s}": ease is one of ${EASES.join(", ")}.`);
    out.ease = m[4] as PathTiming["ease"];
  }
  return out;
}

/** "pan_left" or "pan_left:0.2": a whole-picture move for animate, and how far (0.05–0.4). */
export function parseFrameMove(s: string): { move: FrameMove; amount?: number } {
  const [move, amount] = s.split(":");
  if (amount === undefined) return { move: move as FrameMove };
  const a = Number(amount);
  if (!Number.isFinite(a) || a < 0.05 || a > 0.4) throw new Error(`Frame move "${s}": the amount is 0.05 to 0.4.`);
  return { move: move as FrameMove, amount: a };
}

type Value = string | number | boolean;

const coerce = (v: string): Value => (v === "true" ? true : v === "false" ? false : v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v);

/** "key=value" pairs (numbers and true/false come out typed); a key given twice becomes a list. */
export function parsePairs(list: string[] = [], what = "value"): Record<string, Value | Value[]> {
  const out: Record<string, Value | Value[]> = {};
  for (const item of list) {
    const i = item.indexOf("=");
    if (i < 1) throw new Error(`${what} "${item}": write it as key=value.`);
    const key = item.slice(0, i).trim();
    const value = coerce(item.slice(i + 1));
    const had = out[key];
    out[key] = had === undefined ? value : Array.isArray(had) ? [...had, value] : [had, value];
  }
  return out;
}

/** "ID", "ID:in-out" or "ID:in-out:dissolve" (seconds): one clip of the edit. A trailing "!" mutes it. */
export function parseClip(s: string): Partial<Clip> & { take: string } {
  const muted = s.endsWith("!");
  const parts = (muted ? s.slice(0, -1) : s).replace(/^take:/, "").split(":");
  const take = parts[0];
  // The range is optional, so "ID:dissolve" names the join straight away.
  const [range, join] = parts[1] === "cut" || parts[1] === "dissolve" ? [undefined, parts[1]] : [parts[1], parts[2]];
  if (!take) throw new Error(`Clip "${s}": which take?`);
  const clip: Partial<Clip> & { take: string } = { take };
  if (range) {
    const m = /^([\d.]+)-([\d.]+)$/.exec(range);
    if (!m || Number(m[2]) <= Number(m[1])) throw new Error(`Clip "${s}": the range is in-out seconds, e.g. ${take}:1.5-4`);
    clip.in = Number(m[1]);
    clip.out = Number(m[2]);
  }
  if (join) {
    if (join !== "cut" && join !== "dissolve") throw new Error(`Clip "${s}": the join is cut or dissolve.`);
    clip.join = join;
  }
  if (muted) clip.muted = true;
  return clip;
}

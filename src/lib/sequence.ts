// The edit: takes laid end to end, each trimmed to an in and out point, joined by a cut or a
// dissolve. Shared by the editor (layout, playback, editing) and the server (export).

export interface Clip {
  /** This clip's own id: one take can be cut into the sequence more than once. */
  id: string;
  take: string;
  /** Seconds into the take where the clip starts and ends. */
  in: number;
  out: number;
  /** How this clip comes in from the one before it. */
  join?: "cut" | "dissolve";
  muted?: boolean;
}

/** What the edit needs to know about a take. */
export interface Source {
  seconds: number;
  fps: number;
  /** Frames that repeat the previous take (a continued shot); trimmed off by default. */
  trimHead?: number;
}

export const DISSOLVE = 0.5;
/** Shortest a clip can be trimmed to. */
export const MIN_CLIP = 0.2;

export const newClipId = () => Math.random().toString(36).slice(2, 10);

/** A whole take as a clip, minus any frames that repeat the take before it. */
export function clipFor(take: string, src: Source | undefined): Clip {
  const seconds = src?.seconds ?? 0;
  const head = src?.trimHead ? src.trimHead / (src.fps || 24) : 0;
  return { id: newClipId(), take, in: Math.min(head, Math.max(0, seconds - MIN_CLIP)), out: seconds, join: "cut" };
}

/** Sequences saved before clips existed were plain take ids. */
export function normalize(raw: unknown, sources: (take: string) => Source | undefined): Clip[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): Clip[] => {
    if (typeof x === "string") return [clipFor(x, sources(x))];
    if (x && typeof x === "object" && typeof (x as Clip).take === "string") {
      const c = x as Clip;
      return [{ ...c, id: c.id || newClipId(), in: Number(c.in) || 0, out: Number(c.out) || 0 }];
    }
    return [];
  });
}

export const lengthOf = (c: Clip) => Math.max(0, c.out - c.in);

/**
 * A clip as it can actually be cut: in and out inside the take, out after in by at least MIN_CLIP.
 * An end of 0 means "not known yet" and runs to the end of the take (kept as 0 while its length is unknown).
 */
export function sanitize(c: Clip, src: Source | undefined): Clip {
  const end = src?.seconds && src.seconds > 0 ? src.seconds : Infinity;
  const start = Math.max(0, Math.min(Number(c.in) || 0, end - MIN_CLIP));
  let out = Number(c.out) || 0;
  if (out <= start) out = end === Infinity ? (out > 0 ? start + MIN_CLIP : 0) : end;
  out = Math.min(out, end);
  if (out > 0 && out - start < MIN_CLIP) out = Math.min(end, start + MIN_CLIP);
  return { ...c, in: start, out };
}

/** A dissolve can't be longer than half of either clip it joins. */
export function dissolveOf(prev: Clip | undefined, c: Clip): number {
  if (!prev || c.join !== "dissolve") return 0;
  return Math.min(DISSOLVE, lengthOf(prev) / 2, lengthOf(c) / 2);
}

export interface Placed {
  clip: Clip;
  index: number;
  /** Where the clip starts on the timeline, in seconds. A dissolve starts it early, over the last one. */
  start: number;
  /** Length of the dissolve into this clip (0 for a cut). */
  fadeIn: number;
  length: number;
}

export function layout(clips: Clip[]): { placed: Placed[]; total: number } {
  const placed: Placed[] = [];
  let end = 0;
  clips.forEach((clip, index) => {
    const fadeIn = dissolveOf(clips[index - 1], clip);
    const start = Math.max(0, end - fadeIn);
    const length = lengthOf(clip);
    placed.push({ clip, index, start, fadeIn, length });
    end = start + length;
  });
  return { placed, total: end };
}

/** The clips showing at time t (two during a dissolve), the later one last. */
export function at(placed: Placed[], t: number): Placed[] {
  return placed.filter((p) => t >= p.start && t < p.start + p.length);
}

/** Cut the clip under time t in two. Returns the clips unchanged if t is too near an edge. */
export function split(clips: Clip[], t: number): { clips: Clip[]; at: number } | null {
  const { placed } = layout(clips);
  const hit = at(placed, t).at(-1);
  if (!hit) return null;
  const cut = hit.clip.in + (t - hit.start);
  if (cut - hit.clip.in < MIN_CLIP || hit.clip.out - cut < MIN_CLIP) return null;
  const a: Clip = { ...hit.clip, out: cut };
  const b: Clip = { ...hit.clip, id: newClipId(), in: cut, join: "cut" };
  return { clips: [...clips.slice(0, hit.index), a, b, ...clips.slice(hit.index + 1)], at: hit.index + 1 };
}

/** Set a clip's in or out point, kept inside its take and at least MIN_CLIP long, on whole frames. */
export function trim(c: Clip, edge: "in" | "out", value: number, src: Source): Clip {
  const frame = 1 / (src.fps || 24);
  const snap = (v: number) => Math.round(v / frame) * frame;
  if (edge === "in") return { ...c, in: Math.max(0, Math.min(snap(value), c.out - MIN_CLIP)) };
  return { ...c, out: Math.min(src.seconds, Math.max(snap(value), c.in + MIN_CLIP)) };
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
}

/** "00:12:07" — seconds and frames at 24 fps, as an editor reads it. */
export function timecode(t: number, fps = 24): string {
  const frames = Math.round(Math.max(0, t) * fps);
  const s = Math.floor(frames / fps);
  const f = frames % fps;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

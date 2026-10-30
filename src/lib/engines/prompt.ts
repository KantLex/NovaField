// Turns the director's panel into the prose MiniMax H3 reads.

import { ANGLES, describeLayers, LENSES, MOVES, SHOT_SIZES, lensPrompt } from "../cinema/moves";
import { LIGHTING, LOOKS } from "../cinema/looks";
import type { CameraPath } from "../cinema/camera";
import { describeBlocking, describePath } from "../cinema/custom";
import type { Asset, ShotSpec } from "./specs";

/** Cast pictures that are the same subject: the same library asset, or the same name. */
export function sameSubject(cast: Asset[], i: number): number[] {
  const c = cast[i];
  const key = c.group ?? (c.label ? `label:${c.label.toLowerCase()}` : null);
  if (!key) return [i];
  return cast.map((x, j) => ((x.group ?? (x.label ? `label:${x.label.toLowerCase()}` : null)) === key ? j : -1)).filter((j) => j >= 0);
}

/**
 * Replace @mentions with H3's reference tags. `@1` and `@Mira` (a cast label) both become
 * `<Picture 1>`. Names are never sent: H3 tends to print them onto clothing as text. The first
 * mention of a library asset with a description carries it, in brackets.
 */
export function resolveMentions(text: string, cast: Asset[], plain = false): string {
  const described = new Set<number>();
  return text.replace(/@([\p{L}\p{N}_-]+)/gu, (whole, token: string) => {
    const n = Number(token);
    const i = Number.isInteger(n) && n >= 1 && n <= cast.length ? n - 1 : cast.findIndex((c) => c.label && c.label.toLowerCase() === token.toLowerCase());
    if (i < 0) return whole;
    const first = sameSubject(cast, i)[0];
    const note = cast[first].note && !described.has(first) ? ` (${cast[first].note})` : "";
    described.add(first);
    // Other models don't know H3's tags: say the name, or "the subject" when there is none.
    if (plain) return (cast[i].label || (i === 0 ? "the subject" : `the person in reference ${i + 1}`)) + note;
    return `<Picture ${first + 1}>${note}`;
  });
}

const tags = (ix: number[]) => {
  const t = ix.map((i) => `<Picture ${i + 1}>`);
  return t.length > 1 ? `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}` : t[0];
};

export function composeShotPrompt(
  spec: ShotSpec,
  opts: { rigVideoIndex?: number; previs?: { index: number; follow: "camera" | "action" }; startFrame: boolean; path?: CameraPath; plain?: boolean },
): string {
  const size = SHOT_SIZES.find((s) => s.id === spec.size)!;
  const angle = ANGLES.find((a) => a.id === spec.angle)!;
  const move = MOVES.find((m) => m.id === spec.move) ?? MOVES[0];
  const lens = LENSES.includes(spec.lens) ? lensPrompt[spec.lens] : "";
  const light = LIGHTING.find((l) => l.id === spec.lighting)?.prompt ?? "";
  const look = LOOKS.find((l) => l.id === spec.film.look);

  const parts: string[] = [];
  const body = resolveMentions(spec.prompt.trim(), spec.cast, opts.plain);
  if (!opts.plain) {
    // One entry per subject: a character registered with five pictures is still one character.
    const subjects: number[][] = [];
    spec.cast.forEach((_, i) => {
      const group = sameSubject(spec.cast, i);
      if (group[0] === i) subjects.push(group);
    });
    const unmentioned = subjects.filter((g) => !g.some((i) => body.includes(`<Picture ${i + 1}>`)));
    if (unmentioned.length) {
      const who = unmentioned.map((g) => `<Picture ${g[0] + 1}>${spec.cast[g[0]].note ? ` (${spec.cast[g[0]].note})` : ""}`);
      parts.push(`Featuring ${who.join(" and ")}, kept exactly as they look in the reference.`);
    }
    for (const g of subjects.filter((x) => x.length > 1)) parts.push(`${tags(g)} ${g.length === 2 ? "both" : "all"} show the same subject from different angles; keep every detail of it consistent.`);
  }
  if (opts.startFrame) parts.push("The shot opens exactly on the provided first frame.");
  parts.push(body.endsWith(".") ? body : `${body}.`);

  const off = spec.off ?? {};
  const cine = [size.prompt, angle.id === "eye" ? "" : angle.prompt, lens].filter(Boolean).join(", ");
  if (!off.framing) parts.push(`Cinematography: ${cine}.`);
  if (off.move) {
    // The camera is left to the prompt.
  } else if (opts.previs) {
    const v = `<Video ${opts.previs.index}>`;
    parts.push(
      `Camera: follow the previs ${v} exactly: its camera position, direction, framing changes, speed and timing.${
        opts.previs.follow === "action"
          ? ` The people and objects are placed and move exactly as in ${v}.`
          : ` Only its camera movement matters; the action comes from the script, not from what happens in ${v}.`
      } ${v} is only a rough previs; never copy its look, colours, textures, lighting, characters or any text in it.`,
    );
  } else if (spec.rig && opts.path) {
    parts.push(`Camera: ${describePath(opts.path)}`);
  } else if (spec.combo?.length) {
    parts.push(`Camera: ${describeLayers(spec.combo)}${(spec.shake ?? 0) > 0.25 ? ", handheld with natural shake" : ""}.`);
  } else {
    parts.push(`Camera: ${move.prompt}${spec.intensity < 0.6 ? ", subtle and slow" : spec.intensity > 1.25 ? ", fast and dramatic" : ""}${(spec.shake ?? 0) > 0.25 ? ", handheld with natural shake" : ""}.`);
  }
  if (opts.rigVideoIndex) {
    const people = opts.path?.actors?.length ?? 0;
    parts.push(
      `Match the camera path of <Video ${opts.rigVideoIndex}> exactly: its position, direction, speed and timing.${
        people > 1 || (spec.rig && describeBlocking(opts.path!)) ? ` The people move exactly like the coloured stand-in figures in <Video ${opts.rigVideoIndex}>.` : ""
      } <Video ${opts.rigVideoIndex}> is only a grey wireframe motion guide; never show its grid, lines, stand-in figures or colours.`,
    );
  }
  if (light && !off.light) parts.push(`Lighting: ${light}.`);
  if (look?.prompt && !off.film) parts.push(`Look: ${look.prompt}.`);
  parts.push(spec.sound ? "Natural synchronised sound." : "");
  return parts.filter(Boolean).join(" ");
}

"use client";

// Grade a finished clip: try film looks and lens effects live on the playing clip, check one frame
// on the real GPU node, then apply it as a new take. The original take is never changed.

import clsx from "clsx";
import { Columns2, LoaderCircle, Pause, Play, RotateCcw, ScanEye, Volume2, VolumeX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type ColourKey, DEFAULT_GRADE, isIdentity } from "@/lib/cinema/grade";
import { filmSupport, NO_CAPABILITIES } from "@/lib/engines/capabilities";
import { filmBlocker, gradeBlocker, gradeChanges, motionOn } from "@/lib/engines/grade";
import { matchShift, type LabStats } from "@/lib/cinema/match";
import { LOOKS } from "@/lib/cinema/looks";
import { timecode } from "@/lib/engines/sizing";
import type { Asset, FilmLab, GradeMotion, GradeSpec } from "@/lib/engines/specs";
import type { Job } from "@/lib/jobs";
import { api, fail, toast } from "../api";
import { Button, Section, Segmented, Slider, Toggle } from "../controls";
import { randomSeed, useLive } from "../state";
import { GradeCanvas } from "./GradeCanvas";
import { labOf } from "./labOf";
import { tr } from "@/i18n";

/** Which take the grade sheet is open on, and the last grade used (the next one starts from it). */
export const useGrade = create<{ job: string | null; last: FilmLab; open: (id: string) => void; close: () => void; keep: (f: FilmLab) => void }>()(
  persist(
    (set) => ({
      job: null,
      last: DEFAULT_GRADE,
      open: (job) => set({ job }),
      close: () => set({ job: null }),
      keep: (last) => set({ last }),
    }),
    { name: "novafield-grade", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ last: s.last }) as never },
  ),
);

const EFFECTS: { key: "grain" | "halation" | "vignette" | "chromatic" | "gateWeave" | "streak"; label: string }[] = [
  { key: "grain", label: "Grain" },
  { key: "halation", label: "Halation" },
  { key: "vignette", label: "Vignette" },
  { key: "chromatic", label: "Chromatic" },
  { key: "gateWeave", label: "Gate weave" },
  { key: "streak", label: "Streak" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;

/** The colour controls after the look, each neutral at 0. */
const COLOUR: { key: ColourKey; label: string; min: number; max: number; step: number; format: (v: number) => string }[] = [
  { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.05, format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}` },
  { key: "contrast", label: "Contrast", min: -1, max: 1, step: 0.05, format: signed },
  { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.05, format: signed },
  { key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.05, format: signed },
  { key: "tint", label: "Tint", min: -1, max: 1, step: 0.05, format: signed },
  { key: "fade", label: "Fade", min: 0, max: 1, step: 0.05, format: pct },
];

/** A look as picked: its own grain, halation and vignette (and gate weave, for small-gauge film). */
const lookDefaults = (l: (typeof LOOKS)[number]) => ({ look: l.id, grain: l.grain, halation: l.halation, vignette: l.vignette, ...(l.gateWeave !== undefined ? { gateWeave: l.gateWeave } : {}) });

/** Mounted once in the shell; shows itself when a take is opened for grading. */
export function GradeSheet() {
  const id = useGrade((s) => s.job);
  const job = useLive((s) => (id ? s.jobs[id] : null));
  if (!id || !job?.video) return null;
  return <Sheet key={job.id} job={job} />;
}

// The clip as ComfyUI sees it, copied over once per take.
const sources = new Map<string, Promise<Asset>>();
const sourceOf = (job: Job) => {
  let p = sources.get(job.id);
  if (!p) {
    p = api.useTake(job.id, "raw").then((a) => ({ ...a, label: job.title }));
    p.catch(() => sources.delete(job.id));
    sources.set(job.id, p);
  }
  return p;
};

function Sheet({ job }: { job: Job }) {
  const { close, keep, last } = useGrade.getState();
  const router = useRouter();
  const status = useLive((s) => s.status);
  // A take made with a look on the GPU starts from that look; otherwise from the last grade used.
  const start = job.spec.kind === "shot" && job.spec.film.look !== "none" && !job.spec.filmOnGpu ? job.spec.film : last;
  const [film, setFilm] = useState<FilmLab>(start);
  const [seed] = useState(() => randomSeed() % 2 ** 31);
  // State, so the canvas starts once the element exists; a ref for seeking it.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const player = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [comparing, setComparing] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [noGl, setNoGl] = useState(false);
  // The exact frame is only good for the grade and moment it was made for.
  const [exact, setExact] = useState<{ url: string; key: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Continuity: the shot to match (a frame of it, and its colour), and how.
  const [matchTake, setMatchTake] = useState<string | null>(null);
  const [matchRef, setMatchRef] = useState<{ take: string; asset: Asset; lab: LabStats } | null>(null);
  const [matchAmount, setMatchAmount] = useState(1);
  const [colourOnly, setColourOnly] = useState(false);
  const [ownLab, setOwnLab] = useState<LabStats | null>(null);
  const [motion, setMotion] = useState<GradeMotion>({ shutter: 0, speed: 1 });
  const jobs = useLive((s) => s.jobs);
  const key = JSON.stringify(film) + time.toFixed(2);
  const showExact = exact?.key === key ? exact.url : null;
  const caps = status?.caps ?? NO_CAPABILITIES;
  const ready = !!caps.pack.lensFilm;
  const support = filmSupport(caps);
  const fps = job.meta?.fps || 24;
  const matched = !!matchRef && matchRef.take === matchTake;
  const match = matched ? { reference: matchRef.asset, amount: matchAmount, colourOnly } : undefined;
  const draft: GradeSpec = {
    kind: "grade",
    source: { name: "", kind: "video", url: "", width: job.meta?.width, height: job.meta?.height, fps, frames: job.meta?.frames, duration: job.meta?.seconds },
    film,
    match,
    motion: motionOn(motion) ? motion : undefined,
    seed,
  };
  const nothing = !gradeChanges(draft);
  // The preview runs anything; the GPU nodes only what their version knows.
  const blocker = ready && !nothing ? gradeBlocker(draft, caps) : null;
  const filmBlock = isIdentity(film) ? null : filmBlocker(film, caps);
  // The clip's own colour, over its filmstrip (many frames), as the node measures the whole clip.
  useEffect(() => {
    const src = job.strip ?? job.poster;
    if (src) labOf(src).then(setOwnLab, () => setOwnLab(null));
  }, [job.strip, job.poster]);
  const shift = useMemo(() => (matched && matchRef && ownLab ? { ...matchShift(ownLab, matchRef.lab, colourOnly), amount: matchAmount } : null), [matched, matchRef, ownLab, colourOnly, matchAmount]);
  const others = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.id !== job.id && j.status === "done" && !!j.video && !!j.poster)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30),
    [jobs, job.id],
  );
  // Clicking another shot while one is loading: only the last pick lands.
  const picking = useRef<string | null>(null);
  const pickMatch = async (ref: Job | null) => {
    picking.current = ref?.id ?? null;
    setMatchTake(ref?.id ?? null);
    if (!ref) return setMatchRef(null);
    try {
      // The middle of the shot stands for it: one frame, in the input folder for the GPU.
      const asset = await api.frame(ref.id, (ref.meta?.seconds ?? 2) / 2);
      const lab = await labOf(asset.url);
      if (picking.current === ref.id) setMatchRef({ take: ref.id, asset, lab });
    } catch (e) {
      if (picking.current === ref.id) fail(e);
    }
  };
  const onFail = useCallback(() => setNoGl(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const set = (p: Partial<FilmLab>) => setFilm((f) => ({ ...f, ...p }));
  const pickLook = (l: (typeof LOOKS)[number]) => set({ ...lookDefaults(l), intensity: l.id === "none" ? 0 : film.intensity || 0.8 });
  // Back to the look as it comes: its own effects, no colour changes, normal grain.
  const reset = () => {
    const l = LOOKS.find((x) => x.id === film.look) ?? LOOKS[0];
    setFilm({ ...lookDefaults(l), intensity: l.id === "none" ? 0 : 0.8, chromatic: 0, gateWeave: l.gateWeave ?? 0, streak: 0 });
  };
  const toggle = () => {
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  };

  const check = async () => {
    if (!video) return;
    video.pause();
    setChecking(true);
    try {
      const frame = await api.frame(job.id, video.currentTime);
      const { url } = await api.gradeFrame(frame.name, film, seed);
      setExact({ url, key: JSON.stringify(film) + video.currentTime.toFixed(2) });
    } catch (e) {
      fail(e);
    } finally {
      setChecking(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const spec: GradeSpec = { ...draft, source: await sourceOf(job), from: job.id };
      const [made] = await api.submit([spec]);
      keep(film);
      close();
      useLive.getState().setFocus(made.id);
      toast("Grading on the GPU. The new take appears on the Studio monitor; the original stays.", "done");
      if (window.location.pathname !== "/") router.push("/");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur" role="dialog" aria-modal aria-label={tr("Grade the film look")}>
      <header className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5">
        <span className="display text-[18px]">{tr("Grade")}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-dim">{job.title}</span>
        <button onClick={close} aria-label={tr("Close")} className="rounded p-1 text-dim hover:bg-raised hover:text-ink">
          <X size={18} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col gap-2 p-3">
          <div className="relative min-h-[240px] flex-1">
            {/* The clip plays here unseen; the canvas shows it graded. */}
            <video
              ref={(el) => {
                player.current = el;
                setVideo(el);
              }}
              src={job.video}
              crossOrigin="anonymous"
              autoPlay
              loop
              muted={muted}
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              className={noGl ? "size-full object-contain" : "pointer-events-none absolute size-px opacity-0"}
            />
            {!noGl && (
              <GradeCanvas video={video} film={isIdentity(film) ? { ...film, look: "none", intensity: 0 } : film} match={shift} split={comparing ? split : 0} fps={fps} seed={seed} onFail={onFail}>
                {showExact && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={showExact} alt={tr("This frame graded on the GPU")} className="absolute inset-0 size-full object-contain" />
                    <span className="absolute top-2 right-2 rounded bg-tungsten px-1.5 text-[11px] font-semibold text-black">{tr("Exact, from the GPU")}</span>
                  </>
                )}
                {comparing && !showExact && (
                  <div
                    className="absolute inset-0 cursor-ew-resize touch-none"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const r = e.currentTarget.getBoundingClientRect();
                      setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
                    }}
                    onPointerMove={(e) => {
                      if (!e.buttons) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      setSplit(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
                    }}
                    role="slider"
                    aria-label={tr("Before and after")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(split * 100)}
                  >
                    <span className="pointer-events-none absolute inset-y-0 w-[2px] bg-tungsten" style={{ left: `calc(${split * 100}% - 1px)` }} />
                    <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/70 px-1.5 text-[11px]">{tr("Before")}</span>
                    <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/70 px-1.5 text-[11px]">{tr("After")}</span>
                  </div>
                )}
              </GradeCanvas>
            )}
          </div>
          {noGl && <p className="text-[12px] text-tally">{tr("This browser can't show the live preview (no WebGL). Use Check exact to see a graded frame.")}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={toggle} aria-label={tr(playing ? "Pause" : "Play")} className="rounded-md bg-raised p-1.5 hover:bg-hover">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <input
              type="range"
              min={0}
              max={video?.duration || 1}
              step={1 / fps}
              value={time}
              onChange={(e) => {
                const v = player.current;
                if (!v) return;
                v.pause();
                v.currentTime = Number(e.target.value);
              }}
              aria-label={tr("Scrub")}
              className="h-1 min-w-[120px] flex-1"
            />
            <span className="readout w-20 text-[13px] text-dim">{timecode(time * fps, fps)}</span>
            <button onClick={() => setMuted((m) => !m)} aria-label={tr(muted ? "Sound on" : "Sound off")} className="rounded-md p-1.5 text-dim hover:bg-raised hover:text-ink">
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button
              onClick={() => setComparing((c) => !c)}
              aria-pressed={comparing}
              disabled={noGl}
              className={clsx("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] disabled:opacity-40", comparing ? "bg-tungsten text-black" : "bg-raised hover:bg-hover")}
            >
              <Columns2 size={14} />
              {tr("Compare")}
            </button>
            <button
              onClick={() => void check()}
              disabled={checking || !ready || isIdentity(film) || !!filmBlock}
              title={tr("Grade the paused frame with the real NovaLensFilm on your GPU")}
              className="flex items-center gap-1.5 rounded-md bg-raised px-2.5 py-1 text-[13px] hover:bg-hover disabled:opacity-40"
            >
              {checking ? <LoaderCircle size={14} className="animate-spin" /> : <ScanEye size={14} />}
              {tr("Check exact")}
            </button>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto border-t border-line/60 p-4 lg:border-t-0 lg:border-l">
          <Section title={tr("Look")}>
            <div className="grid grid-cols-3 gap-1.5">
              {LOOKS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => pickLook(l)}
                  aria-pressed={film.look === l.id}
                  title={tr(l.note)}
                  className={clsx(
                    "flex flex-col gap-1 rounded-[5px] p-1 text-left transition-shadow",
                    film.look === l.id ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_var(--color-dim)]",
                  )}
                >
                  <span className="flex h-5 overflow-hidden rounded-[3px]">
                    {l.swatch.map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="truncate text-[11px]">{tr(l.label)}</span>
                  {ready && !support.looks.includes(l.id) && (
                    <span className="text-[10px] leading-none text-faint" title={tr("This film stock needs NovaField nodes 0.3.0 on the server. Update the NovaField pack in ComfyUI Manager, then restart ComfyUI.")}>
                      {tr("Preview only")}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {film.look !== "none" && <Slider label="Strength" value={film.intensity} min={0} max={1} step={0.05} onChange={(intensity) => set({ intensity })} format={pct} />}
          </Section>
          <Section title={tr("Colour")} aside={ready && !support.controls ? tr("Preview only") : undefined}>
            {COLOUR.map((c) => (
              <Slider key={c.key} label={c.label} value={film[c.key] ?? 0} min={c.min} max={c.max} step={c.step} onChange={(v) => set({ [c.key]: v })} format={c.format} />
            ))}
          </Section>
          <Section title={tr("Lens and film")}>
            {EFFECTS.map((e) => (
              <Slider key={e.key} label={e.label} value={film[e.key]} min={0} max={1} step={0.05} onChange={(v) => set({ [e.key]: v })} format={pct} />
            ))}
            <Slider label="Grain size" value={film.grainSize ?? 1} min={0.5} max={3} step={0.05} onChange={(grainSize) => set({ grainSize })} format={(v) => `×${v.toFixed(1)}`} />
          </Section>
          <button onClick={reset} className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12px] text-dim hover:bg-raised hover:text-ink">
            <RotateCcw size={13} />
            {tr("Reset to the look")}
          </button>

          <Section title={tr("Match another shot")} aside={ready && !caps.pack.matchColor ? tr("Preview only") : undefined}>
            <p className="-mt-1 text-[12px] text-faint">{tr("Give this clip the colour of another shot, so the cut between them doesn't jump.")}</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => void pickMatch(null)}
                aria-pressed={!matchTake}
                className={clsx("h-12 w-16 shrink-0 rounded-[4px] text-[11px]", !matchTake ? "bg-raised text-ink shadow-[0_0_0_2px_var(--color-tungsten)]" : "bg-surround text-dim hover:text-ink")}
              >
                {tr("None")}
              </button>
              {others.map((t) => (
                <button
                  key={t.id}
                  onClick={() => void pickMatch(t)}
                  aria-pressed={matchTake === t.id}
                  aria-label={tr("Match {name}", { name: t.title })}
                  title={t.title}
                  className={clsx("relative h-12 w-20 shrink-0 overflow-hidden rounded-[4px]", matchTake === t.id ? "shadow-[0_0_0_2px_var(--color-tungsten)]" : "opacity-80 hover:opacity-100")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={t.poster} alt="" className="size-full object-cover" />
                  {matchTake === t.id && !match && <LoaderCircle size={14} className="absolute inset-0 m-auto animate-spin text-ink" />}
                </button>
              ))}
            </div>
            {match && (
              <>
                <Slider label="Amount" value={matchAmount} min={0} max={1} step={0.05} onChange={setMatchAmount} format={pct} />
                <Toggle label="Keep this clip's brightness" hint="Match only the colour, not the exposure and contrast." checked={colourOnly} onChange={setColourOnly} />
              </>
            )}
          </Section>

          <Section title={tr("Motion")} aside={ready && !caps.pack.shutter ? tr("Preview only") : undefined}>
            <Slider label="Shutter" value={motion.shutter} min={0} max={360} step={15} onChange={(shutter) => setMotion((m) => ({ ...m, shutter }))} format={(v) => (v ? `${v}°` : tr("Off"))} />
            <p className="-mt-1 text-[12px] text-faint">{tr("180° is the film look: natural motion blur. 45° is crisp and staccato; 360° smears like a dream.")}</p>
            <Segmented
              label="Speed"
              size="sm"
              value={motion.speed}
              onChange={(speed) => setMotion((m) => ({ ...m, speed }))}
              options={[0.5, 0.75, 1, 1.5, 2].map((v) => ({ id: v, label: `${v}×` }))}
            />
            {motionOn(motion) && (
              <p className="text-[12px] text-faint">
                {tr("Motion blur and speed show in the result, not in the live preview. They add an in-between-frames pass on the GPU (a minute or two).")}
                {motion.speed !== 1 && ` ${tr("The sound is left out at a new speed.")}`}
              </p>
            )}
          </Section>

          <div className="mt-auto flex flex-col gap-2 border-t border-line/60 pt-4">
            <Button variant="solid" className="py-2.5 text-[15px]" disabled={busy || !ready || nothing || !!blocker} onClick={() => void apply()}>
              {tr("Apply to the clip")}
            </Button>
            <p className="text-[12px] text-dim">
              {!status
                ? tr("Checking the server…")
                : !ready
                  ? <span className="text-tally">{tr("Grading needs the NovaField nodes (NovaLensFilm). Install the pack to unlock it.")}</span>
                  : nothing
                    ? tr("Pick a look or turn up an effect: this grade changes nothing.")
                    : blocker
                      ? <span className="text-tally">{tr(blocker)}</span>
                    : tr("Graded on your GPU by NovaLensFilm: no model, no credits. The sound is kept and the original take stays.")}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

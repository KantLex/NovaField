"use client";

import clsx from "clsx";
import { Download, FastForward, LoaderCircle, Pause, Play, Plus, Redo2, Scissors, SkipBack, SkipForward, SplitSquareHorizontal, Trash2, Undo2, Volume2, VolumeX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@/lib/jobs";
import { clipFor, layout, move, newClipId, split, timecode, trim, type Clip } from "@/lib/sequence";
import { api, fail, toast } from "@/ui/api";
import { Button, IconButton } from "@/ui/controls";
import { Playhead } from "@/ui/edit/playhead";
import { Program } from "@/ui/edit/Program";
import { TAKE_MIME, Timeline } from "@/ui/edit/Timeline";
import { inView, useProjects } from "@/ui/projects";
import { sourceOf, useSequence } from "@/ui/sequence";
import { sequenceKey, useLive, useStudio } from "@/ui/state";
import { tr } from "@/i18n";
import { shatter } from "@/ui/shatter";
import { useHotkeys } from "@/ui/hotkeys";
import { useHistory } from "@/ui/useHistory";

const HISTORY = 100;

export default function SequencePage() {
  const jobs = useLive((s) => s.jobs);
  const [saved, save] = useSequence();
  const current = useProjects((s) => s.current);
  const patch = useStudio((s) => s.patch);
  const router = useRouter();
  const [film, setFilm] = useState<{ url: string; title: string } | null>(null);
  const [building, setBuilding] = useState(false);
  const [title, setTitle] = useState(() => tr("Untitled film"));
  const [selected, setSelected] = useState<string | null>(null);
  const [scale, setScale] = useState(48);
  // While a trim handle is dragged the edit updates here, and is saved (with undo) on release.
  const [draft, setDraft] = useState<Clip[] | null>(null);
  const clips = draft ?? saved;
  const { placed, total } = useMemo(() => layout(clips), [clips]);
  const [playhead] = useState(() => new Playhead());
  useEffect(() => playhead.setTotal(total), [playhead, total]);
  const [playing, setPlaying] = useState(false);
  useEffect(() => playhead.onState(setPlaying), [playhead]);
  const tc = useRef<HTMLSpanElement>(null);
  useEffect(() => playhead.on((t) => tc.current && (tc.current.textContent = timecode(t))), [playhead]);

  // Undo and redo for every edit.
  const history = useHistory(saved, save, HISTORY, sequenceKey(current));
  const commit = (next: Clip[]) => {
    history.commit(next);
    setDraft(null);
  };
  const { undo, redo } = history;

  const sel = placed.find((p) => p.clip.id === selected) ?? null;
  const update = (id: string, change: Partial<Clip>) => commit(saved.map((c) => (c.id === id ? { ...c, ...change } : c)));
  const remove = (id: string) => {
    shatter(`[data-clip="${CSS.escape(id)}"]`);
    commit(saved.filter((c) => c.id !== id));
    setSelected(null);
  };
  const insert = (take: string, index: number) => {
    const c = clipFor(take, sourceOf(jobs[take]));
    commit([...saved.slice(0, index), c, ...saved.slice(index)]);
    setSelected(c.id);
  };
  const splitHere = () => {
    const r = split(saved, playhead.t);
    if (!r) return toast("Put the playhead inside a clip, away from its ends, to split it.");
    commit(r.clips);
    setSelected(r.clips[r.at].id);
  };
  /** I and O: the selected clip starts or ends where the playhead is. */
  const markAtPlayhead = (edge: "in" | "out") => {
    const p = sel ?? placed.find((x) => playhead.t >= x.start && playhead.t < x.start + x.length);
    const src = p && sourceOf(jobs[p.clip.take]);
    if (!p || !src) return;
    const t = p.clip.in + (playhead.t - p.start);
    commit(saved.map((c) => (c.id === p.clip.id ? trim(c, edge, t, src) : c)));
    if (edge === "in") playhead.seek(p.start);
  };
  const edits = useMemo(() => [0, ...placed.map((p) => p.start), total], [placed, total]);
  const jump = (dir: 1 | -1) => {
    const t = playhead.t;
    const to = dir > 0 ? edits.find((e) => e > t + 1e-3) : [...edits].reverse().find((e) => e < t - 1e-3);
    playhead.setPlaying(false);
    playhead.seek(to ?? (dir > 0 ? total : 0));
  };

  // Keyboard, as in an editing app. Not while typing in a field.
  useHotkeys((e) => {
    const mod = e.metaKey || e.ctrlKey;
    const frame = 1 / 24;
    const k = e.key.toLowerCase();
    const step = (d: number) => {
      playhead.setPlaying(false);
      playhead.seek(playhead.t + d);
    };
    if (k === " " || k === "k") {
      e.preventDefault();
      playhead.setPlaying(k === "k" ? false : !playhead.playing);
    }
    else if (k === "arrowleft") step(-(e.shiftKey ? 1 : frame));
    else if (k === "arrowright") step(e.shiftKey ? 1 : frame);
    else if (k === "arrowup") jump(-1);
    else if (k === "arrowdown") jump(1);
    else if (k === "home") playhead.seek(0);
    else if (k === "end") playhead.seek(total);
    else if (k === "z" && mod) (e.shiftKey ? redo : undo)();
    else if (k === "y" && mod) redo();
    else if (mod) return;
    else if (k === "s") splitHere();
    else if (k === "i") markAtPlayhead("in");
    else if (k === "o") markAtPlayhead("out");
    else if ((k === "backspace" || k === "delete") && selected) remove(selected);
    else if (k === "escape") setSelected(null);
    else return;
    e.preventDefault();
  });
  // Leaving the page stops playback.
  useEffect(() => () => playhead.setPlaying(false), [playhead]);

  const candidates = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.status === "done" && !!j.video && inView(j, current))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 36),
    [jobs, current],
  );
  const inEdit = useMemo(() => new Set(saved.map((c) => c.take)), [saved]);

  const assemble = async () => {
    setBuilding(true);
    playhead.setPlaying(false);
    try {
      setFilm(await api.assemble(saved, title));
      toast(tr("Film assembled."), "done");
    } catch (e) {
      fail(e);
    } finally {
      setBuilding(false);
    }
  };

  const first = clips[0] && jobs[clips[0].take]?.meta;
  const aspect = first && first.height > 0 ? first.width / first.height : 16 / 9;
  const last = clips.length ? jobs[clips[clips.length - 1].take] : undefined;
  const fit = () => setScale(Math.max(8, Math.min(240, (window.innerWidth - 120) / Math.max(total, 1))));

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="display w-full max-w-[640px] rounded-md bg-transparent text-[30px] leading-tight focus:bg-panel focus:outline-none"
            aria-label={tr("Film title")}
          />
          <p className="text-[13px] text-dim">
            {tr("{n} clips, running time", { n: clips.length })} <span className="readout text-[15px] text-ink">{timecode(total)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {last?.kind === "shot" && (
            <Button
              onClick={() => {
                if (last.spec.kind !== "shot") return;
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { kind, seed, extend, ...rest } = last.spec;
                patch({ ...rest, prompt: "", startFrame: undefined, endFrame: undefined, extendFrom: last.id });
                router.push("/");
              }}
            >
              <FastForward size={14} /> {tr("Continue the last shot")}
            </Button>
          )}
          <Button variant="solid" disabled={!clips.length || building} onClick={assemble}>
            {building ? <LoaderCircle size={14} className="animate-spin" /> : <Scissors size={14} />}
            {tr("Assemble film")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="mx-auto w-full" style={{ maxWidth: `min(100%, calc(46vh * ${aspect}))` }}>
            <Program placed={placed} jobs={jobs} playhead={playhead} aspect={aspect} />
          </div>
          {/* Transport. */}
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <IconButton label="Previous edit (↑)" onClick={() => jump(-1)}>
              <SkipBack size={15} />
            </IconButton>
            <button
              onClick={() => playhead.setPlaying(!playing)}
              disabled={!clips.length}
              aria-label={tr(playing ? "Pause (Space)" : "Play (Space)")}
              className="flex size-9 items-center justify-center rounded-full bg-tungsten text-black transition-transform active:scale-95 disabled:opacity-40"
            >
              {playing ? <Pause size={16} /> : <Play size={16} className="translate-x-px" />}
            </button>
            <IconButton label="Next edit (↓)" onClick={() => jump(1)}>
              <SkipForward size={15} />
            </IconButton>
            <span className="readout ml-2 text-[16px] text-ink">
              <span ref={tc}>00:00:00</span>
              <span className="text-faint"> / {timecode(total)}</span>
            </span>
            <span className="flex-1" />
            <IconButton label="Split at the playhead (S)" onClick={splitHere} disabled={!clips.length}>
              <SplitSquareHorizontal size={15} />
            </IconButton>
            <IconButton label="Undo (⌘Z)" onClick={undo} disabled={!history.canUndo}>
              <Undo2 size={15} />
            </IconButton>
            <IconButton label="Redo (⇧⌘Z)" onClick={redo} disabled={!history.canRedo}>
              <Redo2 size={15} />
            </IconButton>
            <label className="ml-2 flex items-center gap-2 text-[12px] text-dim">
              {tr("Zoom")}
              <input type="range" min={8} max={240} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="w-24 accent-tungsten" aria-label={tr("Timeline zoom")} />
            </label>
            <button onClick={fit} className="rounded px-1.5 py-0.5 text-[12px] text-dim hover:bg-raised hover:text-ink">
              {tr("Fit")}
            </button>
          </div>
        </div>

        <ClipPanel
          clip={sel?.clip ?? null}
          job={sel ? jobs[sel.clip.take] : undefined}
          index={sel?.index ?? 0}
          onChange={(change) => sel && update(sel.clip.id, change)}
          onRemove={() => sel && remove(sel.clip.id)}
          onDuplicate={() => {
            if (!sel) return;
            const c = { ...sel.clip, id: newClipId(), join: "cut" as const };
            commit([...saved.slice(0, sel.index + 1), c, ...saved.slice(sel.index + 1)]);
            setSelected(c.id);
          }}
        />
      </div>

      {clips.length === 0 ? (
        <div className="flex h-[118px] items-center justify-center rounded-md border border-dashed border-line text-[13px] text-faint" onDragOver={(e) => e.preventDefault()} onDrop={(e) => e.dataTransfer.getData(TAKE_MIME) && insert(e.dataTransfer.getData(TAKE_MIME), 0)}>
          {tr("Drag takes here from below, or click one to add it.")}
        </div>
      ) : (
        <Timeline
          placed={placed}
          total={total}
          jobs={jobs}
          playhead={playhead}
          scale={scale}
          selected={selected}
          onSelect={setSelected}
          onTrim={(i, edge, value, done) => {
            const c = saved[i];
            const src = sourceOf(jobs[c?.take]);
            if (!c || !src) return;
            const next = saved.map((x, j) => (j === i ? trim(x, edge, value, src) : x));
            if (done) commit(next);
            else setDraft(next);
          }}
          onMove={(from, to) => commit(move(saved, from, to))}
          onInsert={insert}
          onJoin={(i) => update(saved[i].id, { join: saved[i].join === "dissolve" ? "cut" : "dissolve" })}
        />
      )}
      <p className="text-[12px] text-faint">
        {tr("Space plays · ←/→ a frame (⇧ a second) · ↑/↓ previous or next cut · S splits · I/O set the clip's start or end at the playhead · Delete removes · drag edges to trim, clips to reorder")}
      </p>

      {film && (
        <section className="grid gap-3 rounded-md bg-panel p-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <video src={film.url} controls className="w-full rounded-[3px] bg-black" />
          <div className="flex flex-col gap-3 p-1">
            <h2 className="display text-[20px]">{film.title}</h2>
            <p className="text-[13px] text-dim">{tr("Cut at 24 fps, with your trims, dissolves and muted clips.")}</p>
            <a href={film.url} download={`${film.title}.mp4`} className="inline-flex items-center gap-1.5 self-start rounded-md bg-tungsten px-3 py-1.5 text-[13px] font-semibold text-black">
              <Download size={14} /> {tr("Download MP4")}
            </a>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-dim">{tr("Finished takes")}</h2>
        {candidates.length === 0 ? (
          <p className="text-[13px] text-faint">{tr("Nothing to add yet.")}</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {candidates.map((c) => (
              <button
                key={c.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(TAKE_MIME, c.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => insert(c.id, saved.length)}
                className="group flex flex-col gap-1 text-left"
                aria-label={tr("Add {name} to the sequence", { name: c.title })}
              >
                <span className="relative block aspect-video overflow-hidden rounded-[3px] bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.poster && <img src={c.poster} alt="" draggable={false} className="size-full object-cover transition-opacity group-hover:opacity-60" />}
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                    <Plus />
                  </span>
                  {inEdit.has(c.id) && <span className="absolute top-1 left-1 rounded bg-tungsten px-1 text-[10px] font-semibold text-black">{tr("In the edit")}</span>}
                </span>
                <span className="truncate text-[12px] text-dim">{c.title}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** The selected clip: its in and out, how it joins the clip before, its sound. */
function ClipPanel({ clip, job, index, onChange, onRemove, onDuplicate }: { clip: Clip | null; job: Job | undefined; index: number; onChange: (c: Partial<Clip>) => void; onRemove: () => void; onDuplicate: () => void }) {
  if (!clip || !job) {
    return <aside className="hidden rounded-md bg-panel p-4 text-[13px] text-dim lg:block">{tr("Select a clip to trim it, change how it joins the one before, or mute it.")}</aside>;
  }
  const src = sourceOf(job);
  const num = (edge: "in" | "out") => (
    <label className="flex flex-col gap-1 text-[12px] text-dim">
      {tr(edge === "in" ? "Starts at (s)" : "Ends at (s)")}
      <SecondsInput
        // A new clip (or an edit from elsewhere) puts its own value in the box.
        key={`${clip.id}-${edge}-${clip[edge]}`}
        value={clip[edge]}
        max={src?.seconds}
        onCommit={(v) => src && onChange(trim(clip, edge, v, src))}
      />
    </label>
  );
  return (
    <aside className="flex flex-col gap-4 rounded-md bg-panel p-4">
      <div>
        <p className="readout text-[13px] text-tungsten">{tr("Clip {n}", { n: index + 1 })}</p>
        <p className="line-clamp-2 text-[14px]">{job.title}</p>
        <p className="readout mt-1 text-[13px] text-faint">
          {timecode(clip.out - clip.in)} {tr("of")} {timecode(src?.seconds ?? 0)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {num("in")}
        {num("out")}
      </div>
      {index > 0 && (
        <div className="flex flex-col gap-1 text-[12px] text-dim">
          {tr("From the clip before")}
          <div className="grid grid-cols-2 gap-1 rounded-md bg-surround p-0.5">
            {(["cut", "dissolve"] as const).map((j) => (
              <button key={j} onClick={() => onChange({ join: j })} className={clsx("rounded px-2 py-1 text-[13px]", (clip.join ?? "cut") === j ? "bg-raised text-ink" : "text-dim hover:text-ink")}>
                {tr(j === "cut" ? "Cut" : "Dissolve")}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onChange({ muted: !clip.muted })}>
          {clip.muted ? <VolumeX size={14} /> : <Volume2 size={14} />} {tr(clip.muted ? "Muted" : "Sound on")}
        </Button>
        <Button onClick={onDuplicate}>{tr("Duplicate")}</Button>
        <Button onClick={onRemove} className="text-tally">
          <Trash2 size={14} /> {tr("Remove")}
        </Button>
      </div>
    </aside>
  );
}

/**
 * A time typed in full before it counts: committed (and clamped) on Enter or leaving the box, so
 * "12" isn't clamped at "1" on the way, and an empty box doesn't collapse the clip.
 */
function SecondsInput({ value, max, onCommit }: { value: number; max?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(Number(value.toFixed(2))));
  const commit = () => {
    const v = Number(text);
    if (text.trim() === "" || !Number.isFinite(v)) return setText(String(Number(value.toFixed(2))));
    if (Math.abs(v - value) > 1e-6) onCommit(v);
  };
  return (
    <input
      type="number"
      step={1 / 24}
      min={0}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className="readout rounded-md bg-surround px-2 py-1 text-[14px] text-ink focus:outline-none"
    />
  );
}

"use client";

// The program monitor: plays the edit as cut, straight from the takes' files. Two players take
// turns: while one shows the current clip the other waits on the next clip's first frame, so
// cuts land without a gap, and a dissolve fades the later one in over the earlier one. A
// soundtrack plays under it all, kept to the playhead, with the takes' sound mixed as exported.

import { useEffect, useRef } from "react";
import type { Job } from "@/lib/jobs";
import { at, UNDER_LEVEL, type Placed, type Soundtrack } from "@/lib/sequence";
import { tr } from "@/i18n";
import type { Playhead } from "./playhead";

export function Program({ placed, jobs, playhead, aspect, soundtrack }: { placed: Placed[]; jobs: Record<string, Job>; playhead: Playhead; aspect: number; soundtrack: Soundtrack | null }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  // The latest edit, for the playback loop (which outlives renders).
  const edit = useRef({ placed, jobs, soundtrack });
  useEffect(() => {
    edit.current = { placed, jobs, soundtrack };
    sync(playhead.t, playhead.playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, jobs, soundtrack]);
  const trackUrl = soundtrack ? (soundtrack.take ? jobs[soundtrack.take]?.audio : soundtrack.url) : undefined;

  function sync(t: number, playing: boolean) {
    const pa = a.current;
    const pb = b.current;
    if (!pa || !pb) return;
    const players = [pa, pb];
    const { placed, jobs, soundtrack } = edit.current;
    // Under a soundtrack the takes are silent ("replace") or lowered ("under"), as in the export.
    const takeLevel = soundtrack ? (soundtrack.mix === "under" ? UNDER_LEVEL : 0) : 1;
    syncMusic(t, playing);
    const live = at(placed, t);
    // At the very end, hold the last frame.
    if (!live.length && placed.length && t >= placed.at(-1)!.start) live.push(placed.at(-1)!);
    const latest = live.at(-1);
    const next = latest ? placed[latest.index + 1] : placed[0];
    const fade = latest && latest.fadeIn > 0 && t < latest.start + latest.fadeIn ? (t - latest.start) / latest.fadeIn : 1;
    players.forEach((el, slot) => {
      const shown = live.find((p) => p.index % 2 === slot);
      const p = shown ?? (next && next.index % 2 === slot ? next : undefined);
      if (!p) {
        el.style.opacity = "0";
        if (!el.paused) el.pause();
        return;
      }
      const video = jobs[p.clip.take]?.video;
      if (video && el.dataset.src !== video) {
        el.dataset.src = video;
        el.src = video;
      }
      const want = shown ? p.clip.in + Math.min(t - p.start, p.length - 1 / 48) : p.clip.in;
      // Playing, the footage keeps its own time; only a real drift (or a paused scrub) seeks.
      if (Math.abs(el.currentTime - want) > (playing && shown ? 0.2 : 1 / 48) && el.readyState > 0) el.currentTime = want;
      el.style.zIndex = String(p.index);
      el.style.opacity = shown ? String(shown === latest ? fade : 1) : "0";
      el.volume = shown && !p.clip.muted ? (shown === latest ? fade : 1 - fade) * takeLevel : 0;
      if (playing && shown && el.paused) void el.play().catch(() => {});
      if ((!playing || !shown) && !el.paused) el.pause();
    });
  }

  /** The soundtrack follows the playhead: `start` seconds in at the film's first frame, fading out over its last second. */
  function syncMusic(t: number, playing: boolean) {
    const el = music.current;
    const { placed, soundtrack } = edit.current;
    if (!el) return;
    const end = placed.length ? placed.at(-1)!.start + placed.at(-1)!.length : 0;
    const want = (soundtrack?.start ?? 0) + t;
    const on = !!soundtrack && el.readyState > 0 && t < end && want < (el.duration || Infinity);
    if (!on) {
      if (!el.paused) el.pause();
      return;
    }
    if (Math.abs(el.currentTime - want) > (playing ? 0.15 : 1 / 48)) el.currentTime = want;
    el.volume = Math.max(0, Math.min(1, soundtrack.volume * Math.min(1, end - t)));
    if (playing && el.paused) void el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  }

  // Playback: the footage is the clock. The earliest clip on screen says where the edit is.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const { placed } = edit.current;
      const lead = at(placed, playhead.t)[0];
      const el = lead ? [a.current, b.current][lead.index % 2] : null;
      if (!lead || !el) return playhead.advance(playhead.total);
      // A clip whose file won't play is skipped rather than holding the edit forever.
      if (el.error) return playhead.advance(lead.start + lead.length);
      // A file that ran out before its out point was seen has stopped (ended is also paused): move on.
      if (el.ended) return playhead.advance(lead.start + lead.length);
      if (el.paused || el.readyState < 2) return; // still starting or buffering: wait for it
      const t = lead.start + (el.currentTime - lead.clip.in);
      // Past the out point (or the file ended): on to the next clip.
      playhead.advance(el.ended || t >= lead.start + lead.length - 1 / 96 ? lead.start + lead.length : Math.max(playhead.t, t));
    };
    const offState = playhead.onState((playing) => {
      cancelAnimationFrame(raf);
      if (playing) raf = requestAnimationFrame(tick);
    });
    const offTime = playhead.on((t, playing) => sync(t, playing));
    return () => {
      cancelAnimationFrame(raf);
      offState();
      offTime();
    };
    // sync reads the latest edit from refs; the loop is set up once per playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead]);

  return (
    <div className="relative w-full overflow-hidden rounded-[3px] bg-black" style={{ aspectRatio: String(aspect) }}>
      {[a, b].map((ref, i) => (
        <video
          key={i}
          ref={ref}
          preload="auto"
          playsInline
          onLoadedMetadata={() => sync(playhead.t, playhead.playing)}
          className="absolute inset-0 size-full object-contain opacity-0"
          onClick={() => playhead.setPlaying(!playhead.playing)}
        />
      ))}
      <audio ref={music} src={trackUrl} preload="auto" onLoadedMetadata={() => sync(playhead.t, playhead.playing)} />
      {!placed.length && <p className="absolute inset-0 flex items-center justify-center text-[13px] text-faint">{tr("The edit plays here.")}</p>}
    </div>
  );
}

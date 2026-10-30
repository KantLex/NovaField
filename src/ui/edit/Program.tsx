"use client";

// The program monitor: plays the edit as cut, straight from the takes' files. Two players take
// turns: while one shows the current clip the other waits on the next clip's first frame, so
// cuts land without a gap, and a dissolve fades the later one in over the earlier one.

import { useEffect, useRef } from "react";
import type { Job } from "@/lib/jobs";
import { at, type Placed } from "@/lib/sequence";
import { tr } from "@/i18n";
import type { Playhead } from "./playhead";

export function Program({ placed, jobs, playhead, aspect }: { placed: Placed[]; jobs: Record<string, Job>; playhead: Playhead; aspect: number }) {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  // The latest edit, for the playback loop (which outlives renders).
  const edit = useRef({ placed, jobs });
  useEffect(() => {
    edit.current = { placed, jobs };
    sync(playhead.t, playhead.playing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, jobs]);

  function sync(t: number, playing: boolean) {
    const pa = a.current;
    const pb = b.current;
    if (!pa || !pb) return;
    const players = [pa, pb];
    const { placed, jobs } = edit.current;
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
      el.volume = shown && !p.clip.muted ? (shown === latest ? fade : 1 - fade) : 0;
      if (playing && shown && el.paused) void el.play().catch(() => {});
      if ((!playing || !shown) && !el.paused) el.pause();
    });
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
      {!placed.length && <p className="absolute inset-0 flex items-center justify-center text-[13px] text-faint">{tr("The edit plays here.")}</p>}
    </div>
  );
}

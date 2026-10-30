"use client";

// The edit's playhead. It moves 60 times a second while playing, so it lives outside React:
// the monitor, the timeline line and the timecode read it directly instead of re-rendering.

type Listener = (t: number, playing: boolean) => void;

export class Playhead {
  t = 0;
  playing = false;
  total = 0;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(playing: boolean) => void>();

  /** The edit's length changed (a trim, a new clip): keep the playhead inside it. */
  setTotal(total: number) {
    this.total = total;
    if (this.t > total) this.seek(total);
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.total, t));
    for (const l of this.listeners) l(this.t, this.playing);
  }

  /** Called by the monitor as the footage plays. */
  advance(t: number) {
    this.seek(t);
    if (this.t >= this.total) this.setPlaying(false);
  }

  setPlaying(playing: boolean) {
    if (playing && this.t >= this.total - 1 / 48) this.t = 0; // play from the top after the end
    if (playing === this.playing) return;
    this.playing = playing;
    for (const l of this.stateListeners) l(playing);
    for (const l of this.listeners) l(this.t, playing);
  }

  on(l: Listener) {
    this.listeners.add(l);
    l(this.t, this.playing);
    return () => void this.listeners.delete(l);
  }

  onState(l: (playing: boolean) => void) {
    this.stateListeners.add(l);
    return () => void this.stateListeners.delete(l);
  }
}

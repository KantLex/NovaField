"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface Previs {
  /** Current previs frame (fractional while playing). */
  frame: number;
  playing: boolean;
  speed: 0.5 | 1;
  loop: boolean;
  thirds: boolean;
  safe: boolean;
  hud: boolean;
  /** Lens picture-in-picture in the Plan view. */
  inset: boolean;
  set: (p: Partial<Omit<Previs, "set" | "seek">>) => void;
  seek: (frame: number) => void;
}

/**
 * One clock for the whole previs: the lens view, the Plan view, the timeline and the camera
 * readout all follow it, so scrubbing moves everything together. Toggles are remembered.
 */
export const usePrevis = create<Previs>()(
  persist(
    (set) => ({
      frame: 0,
      playing: true,
      speed: 1,
      loop: true,
      thirds: false,
      safe: false,
      hud: true,
      inset: true,
      set: (p) => set(p),
      seek: (frame) => set({ frame, playing: false }),
    }),
    {
      name: "novafield-previs",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ speed: s.speed, loop: s.loop, thirds: s.thirds, safe: s.safe, hud: s.hud, inset: s.inset }) as Previs,
    },
  ),
);

/** The frame to draw: whole frames, clamped to the shot. */
export const previsFrame = (frames: number) => Math.max(0, Math.min(frames - 1, Math.floor(usePrevis.getState().frame)));

/** Drives the clock while mounted (the monitor owns it). Holds briefly on the last frame before looping. */
export function usePrevisClock(frames: number, fps: number) {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let holdUntil = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) usePrevis.setState({ playing: false });
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = usePrevis.getState();
      if (!s.playing) return;
      if (holdUntil) {
        if (now < holdUntil) return;
        holdUntil = 0;
        usePrevis.setState({ frame: 0 });
        return;
      }
      const next = s.frame + dt * fps * s.speed;
      if (next >= frames - 1) {
        if (s.loop) {
          usePrevis.setState({ frame: frames - 1 });
          holdUntil = now + 600;
        } else usePrevis.setState({ frame: frames - 1, playing: false });
        return;
      }
      usePrevis.setState({ frame: next });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames, fps]);

  // A new shot length starts from the top.
  useEffect(() => {
    if (usePrevis.getState().frame > frames - 1) usePrevis.setState({ frame: 0 });
  }, [frames]);
}

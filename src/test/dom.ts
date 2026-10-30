// Layout and canvas stand-ins for screen tests: happy-dom lays nothing out and has no 2D canvas.

import { vi } from "vitest";

/** Every element is a w×h box at the page's top-left, so pointer positions map to known places. */
export function stubLayout(width: number, height: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect);
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

export type Call = [method: string, args: unknown[]];

/** A 2D context that draws nothing and remembers every call, for canvases that must be read back. */
export function recordingCanvas() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === "measureText") return (s: string) => ({ width: s.length * 6 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop() {} });
      if (prop === "getLineDash") return () => [];
      return (...args: unknown[]) => void calls.push([String(prop), args]);
    },
    set(t, prop, v) {
      t[prop] = v;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as never);
  return {
    calls,
    /** Where the last frame wrote `text`. */
    lastText(text: string): [number, number] | null {
      const hit = calls.findLast(([m, a]) => m === "fillText" && a[0] === text);
      return hit ? [hit[1][1] as number, hit[1][2] as number] : null;
    },
  };
}

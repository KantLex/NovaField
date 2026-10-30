"use client";

// Deleting something breaks its picture into many small shards that burst, drop a short way and fade.
// Quick and small on purpose. The element itself hides at once; if the delete fails,
// `restore` brings it back.

/** About this many pixels a shard; each cell breaks into two triangles. */
const PIECE = 14;
/** Most cells for one item (so at most twice as many shards), to stay light. */
const MAX_CELLS = 150;
/** Most shards in flight at once, however many things are deleted together. */
const MAX_FLYING = 600;
let flying = 0;

/** Shatter every visible element matching `selector`. Returns a function that undoes the hiding. */
export function shatter(selector: string): () => void {
  if (typeof document === "undefined") return () => {};
  const els = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  });
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hidden: [HTMLElement, string][] = [];
  for (const el of els) {
    const pic = el.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
    const box = (pic && !el.dataset.shatterSrc ? pic : el).getBoundingClientRect();
    // Elements that paint their picture as a background (timeline clips) name it themselves.
    const src = el.dataset.shatterSrc || (pic instanceof HTMLVideoElement ? pic.poster : pic?.src);
    hidden.push([el, el.style.visibility]);
    el.style.visibility = "hidden";
    if (calm) continue;
    // Share what's left of the budget; with too little, the item just goes.
    const cells = Math.min(MAX_CELLS, Math.floor((MAX_FLYING - flying) / 2));
    if (cells < 12) continue;
    let cols = Math.max(4, Math.round(box.width / PIECE));
    let rows = Math.max(3, Math.round(box.height / PIECE));
    const fit = Math.sqrt(cells / (cols * rows));
    if (fit < 1) {
      cols = Math.max(4, Math.floor(cols * fit));
      rows = Math.max(3, Math.floor(rows * fit));
    }
    // A picture repeated along the element at its own shape (timeline clips), or one picture filling it.
    const aspect = Number(el.dataset.shatterAspect) || 0;
    const tile = aspect ? `${box.height * aspect}px ${box.height}px repeat-x` : `${box.width}px ${box.height}px no-repeat`;
    const w = box.width / cols;
    const h = box.height / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Each cell breaks along a diagonal into two triangles.
        for (const half of [0, 1]) {
          const shard = document.createElement("div");
          const bg = src ? `url("${src}") ${-col * w}px ${-row * h}px / ${tile}` : "#2a2a2a";
          const clip = (col + row) % 2 ? (half ? "polygon(0 0,100% 0,0 100%)" : "polygon(100% 0,100% 100%,0 100%)") : half ? "polygon(0 0,100% 0,100% 100%)" : "polygon(0 0,100% 100%,0 100%)";
          shard.style.cssText = `position:fixed;left:${box.left + col * w}px;top:${box.top + row * h}px;width:${w + 0.5}px;height:${h + 0.5}px;background:${bg};clip-path:${clip};z-index:70;pointer-events:none;will-change:transform,opacity`;
          document.body.appendChild(shard);
          flying++;
          let gone = false;
          const done = () => {
            if (gone) return;
            gone = true;
            flying--;
            shard.remove();
          };
          // Pieces burst a little outward from the middle, then drop, each turning its own way.
          const ox = (col + 0.5) / cols - 0.5;
          const oy = (row + 0.5) / rows - 0.5;
          const dx = ox * 46 + (Math.random() - 0.5) * 16;
          const dy = oy * 22 + 18 + Math.random() * 26;
          const turn = (Math.random() - 0.5) * 70;
          const a = shard.animate(
            [
              { transform: "translate(0,0) rotate(0)", opacity: 1 },
              { transform: `translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(0.92)`, opacity: 0 },
            ],
            // Closer to the middle breaks first, so it reads as one crack spreading.
            { duration: 360 + Math.random() * 180, delay: Math.hypot(ox, oy) * 90 + Math.random() * 40, easing: "cubic-bezier(0.4, 0, 0.9, 0.6)", fill: "forwards" },
          );
          a.onfinish = a.oncancel = done;
          // A hidden tab doesn't run animations; never leave a shard behind.
          setTimeout(done, 1200);
        }
      }
    }
  }
  return () => {
    for (const [el, v] of hidden) el.style.visibility = v;
  };
}

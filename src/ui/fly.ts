"use client";

// Takes moved to a project fly there: a copy of each thumbnail arcs from its card to the
// project's row in the Library sidebar (or the header's project switcher when that isn't shown).
// Plain Web Animations on throwaway elements, so nothing in React re-renders for it.

const MAX = 8;

export function flyTakes(ids: string[], project: string | null) {
  if (typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const visible = (el: Element | null): el is HTMLElement => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const row = document.querySelector(`[data-drop-project="${CSS.escape(project ?? "unsorted")}"]`);
  const target = visible(row) ? row : document.querySelector("[data-project-switcher]");
  if (!visible(target)) return;
  const to = target.getBoundingClientRect();
  // Aim at the row's icon, where a folder would be.
  const tx = to.left + 18;
  const ty = to.top + to.height / 2;

  const cards = ids.map((id) => document.querySelector(`[data-take="${CSS.escape(id)}"]`)).filter(visible).slice(0, MAX);
  cards.forEach((card, i) => {
    const thumb = card.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
    const r = (thumb ?? card).getBoundingClientRect();
    const src = thumb instanceof HTMLVideoElement ? thumb.poster : thumb?.src;
    const ghost = document.createElement("div");
    ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:70;pointer-events:none;border-radius:4px;background:#111 center/cover no-repeat${src ? ` url("${src}")` : ""};box-shadow:0 0 0 1px rgba(228,255,26,.6),0 10px 30px rgba(0,0,0,.6);will-change:transform,opacity`;
    document.body.appendChild(ghost);
    const dx = tx - (r.left + r.width / 2);
    const dy = ty - (r.top + r.height / 2);
    const end = Math.max(0.08, 26 / r.width);
    // Up and over: the middle of the path rises a little above the straight line.
    const lift = -Math.min(90, 30 + Math.abs(dx) * 0.12);
    const anim = ghost.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 + lift}px) scale(${(1 + end) / 2.2})`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 0.35 },
      ],
      { duration: 560, delay: i * 45, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" },
    );
    anim.onfinish = anim.oncancel = () => ghost.remove();
    // A hidden tab doesn't run animations; never leave a copy behind.
    setTimeout(() => ghost.remove(), 1500 + i * 45);
  });
  if (cards.length) {
    target.animate([{ transform: "scale(1)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }], { duration: 280, delay: 520 + (cards.length - 1) * 45, easing: "ease-out" });
  }
}

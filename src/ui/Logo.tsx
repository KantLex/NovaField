// NovaField's logo (designed in promo/src/Logo.tsx): a nova, a four-point star, standing on a
// horizon drawn as an anamorphic lens flare. The mark is cropped to its own bounds, so set beside
// the name (Archivo Bold, set tight) at height 0.74em with its bottom on the baseline, it stands as
// tall as the capitals, the star's point just over them.

const STAR = "M50 10 C54.8 34.5 59.5 40.2 72 44 C59.5 47.8 54.8 53 50 74 C45.2 53 40.5 47.8 28 44 C40.5 40.2 45.2 34.5 50 10 Z";
const FLARE = "M10 74 C30 71.6 40 70 50 70 C60 70 70 71.6 90 74 C70 76.4 60 78 50 78 C40 78 30 76.4 10 74 Z";

/** The mark in the current text colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="10 10 80 68" className={className} fill="currentColor" aria-hidden>
      <path d={STAR} />
      <path d={FLARE} />
    </svg>
  );
}

/** The mark and the name, as one line of type at the parent's font size: "Nova" in ink, the mark and "Field" in tungsten. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-[-0.035em] whitespace-nowrap ${className ?? ""}`}>
      <LogoMark className="mr-[0.3em] inline-block h-[0.74em] w-auto align-baseline text-tungsten" />
      Nova<span className="text-tungsten">Field</span>
    </span>
  );
}

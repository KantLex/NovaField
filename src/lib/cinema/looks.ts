// Film stocks (graded on the GPU by NovaLensFilm) and lighting setups (described in the prompt).

export interface FilmLook {
  id:
    | "none"
    | "kodak_2383"
    | "fuji_eterna"
    | "bleach_bypass"
    | "teal_orange"
    | "noir"
    | "technicolor"
    | "moonlight"
    | "vhs_1989"
    | "kodak_portra_400"
    | "kodak_vision3_500t"
    | "ektachrome_e100"
    | "cinestill_800t"
    | "fuji_velvia_50"
    | "kodachrome_64"
    | "ilford_hp5"
    | "instant_film"
    | "super8";
  label: string;
  note: string;
  prompt: string;
  /** Swatch stops for the picker: shadows, mids, highlights. */
  swatch: [string, string, string];
  grain: number;
  halation: number;
  vignette: number;
  /** Looks that come with a wobbling gate (small-gauge film) set it too. */
  gateWeave?: number;
  /** Needs NovaField nodes 0.3.0 or later on the server. */
  since?: "0.3";
}

export const LOOKS: FilmLook[] = [
  { id: "none", label: "Clean digital", note: "No grade", prompt: "", swatch: ["#2b2b2b", "#8a8a8a", "#f2f2f2"], grain: 0, halation: 0, vignette: 0 },
  { id: "kodak_2383", label: "Kodak 2383", note: "Warm print film, rich reds", prompt: "shot on 35mm film, Kodak print stock colour, warm highlights", swatch: ["#1d1a22", "#b06a3c", "#f6dcae"], grain: 0.35, halation: 0.3, vignette: 0.25 },
  { id: "fuji_eterna", label: "Fuji Eterna", note: "Soft, low contrast greens", prompt: "Fuji Eterna film look, soft contrast, muted greens", swatch: ["#1b2421", "#6f8a76", "#e9eedd"], grain: 0.3, halation: 0.15, vignette: 0.2 },
  { id: "bleach_bypass", label: "Bleach bypass", note: "Silver, gritty, desaturated", prompt: "bleach bypass look, desaturated, high contrast, gritty", swatch: ["#121314", "#6c6f70", "#e5e6e1"], grain: 0.5, halation: 0.05, vignette: 0.35 },
  { id: "teal_orange", label: "Teal & orange", note: "Blockbuster contrast", prompt: "blockbuster teal and orange colour grade", swatch: ["#0f2a33", "#c47a45", "#ffd9a8"], grain: 0.2, halation: 0.2, vignette: 0.25 },
  { id: "noir", label: "Noir", note: "Black and white, deep blacks", prompt: "black and white film noir, deep shadows, hard light", swatch: ["#050505", "#6b6b6b", "#f7f7f7"], grain: 0.55, halation: 0.1, vignette: 0.45 },
  { id: "technicolor", label: "Three-strip", note: "Saturated 1950s dye transfer", prompt: "vintage three-strip Technicolor look, saturated primaries", swatch: ["#1e1022", "#c6303f", "#f9e28a"], grain: 0.3, halation: 0.25, vignette: 0.2 },
  { id: "moonlight", label: "Moonlight", note: "Cool day-for-night", prompt: "cool blue moonlit night, day for night", swatch: ["#060b1a", "#3d5a8c", "#c9dcf5"], grain: 0.4, halation: 0.2, vignette: 0.4 },
  { id: "vhs_1989", label: "VHS 1989", note: "Tape bleed and soft scanlines", prompt: "1989 VHS camcorder footage", swatch: ["#1c1626", "#9b5e8c", "#f3e2d0"], grain: 0.45, halation: 0.1, vignette: 0.3 },
  { id: "kodak_portra_400", label: "Portra 400", note: "Warm, natural skin, soft contrast", prompt: "shot on Kodak Portra 400, warm natural skin tones, soft contrast", swatch: ["#2a2420", "#c39478", "#f4e6d4"], grain: 0.3, halation: 0.15, vignette: 0.15, since: "0.3" },
  { id: "kodak_vision3_500t", label: "Vision3 500T", note: "Tungsten cinema negative", prompt: "shot on Kodak Vision3 500T motion picture film, tungsten balanced", swatch: ["#151a22", "#8c7a68", "#f2dfc4"], grain: 0.4, halation: 0.25, vignette: 0.2, since: "0.3" },
  { id: "ektachrome_e100", label: "Ektachrome", note: "Clean, saturated slide film", prompt: "Ektachrome slide film, clean saturated colour, crisp blues", swatch: ["#0c1220", "#3f7fb0", "#f2f5f8"], grain: 0.2, halation: 0.05, vignette: 0.15, since: "0.3" },
  { id: "cinestill_800t", label: "CineStill 800T", note: "Night stock, red glow round lights", prompt: "CineStill 800T night photo, red halation around lights, teal shadows", swatch: ["#0b1a20", "#b0473a", "#ffd9b8"], grain: 0.4, halation: 0.6, vignette: 0.25, since: "0.3" },
  { id: "fuji_velvia_50", label: "Velvia 50", note: "Vivid greens and reds, deep contrast", prompt: "Fuji Velvia slide film, vivid saturated greens and reds, deep contrast", swatch: ["#0c1408", "#3f8f3a", "#f6e9b0"], grain: 0.15, halation: 0.05, vignette: 0.2, since: "0.3" },
  { id: "kodachrome_64", label: "Kodachrome", note: "Classic warm reds, rich blacks", prompt: "Kodachrome 64 film, classic warm reds, rich blacks", swatch: ["#17110e", "#b8452f", "#f5e1a8"], grain: 0.25, halation: 0.1, vignette: 0.25, since: "0.3" },
  { id: "ilford_hp5", label: "Ilford HP5", note: "Black and white, soft and grainy", prompt: "black and white Ilford HP5 film, soft contrast, visible grain", swatch: ["#151515", "#8a8a8a", "#ededed"], grain: 0.6, halation: 0.05, vignette: 0.3, since: "0.3" },
  { id: "instant_film", label: "Instant film", note: "Faded, lifted blacks, green-warm cast", prompt: "instant film photo, faded colours, lifted blacks", swatch: ["#2e3328", "#a59a72", "#efe6c9"], grain: 0.25, halation: 0.15, vignette: 0.4, since: "0.3" },
  { id: "super8", label: "Super 8", note: "Warm home movie with a wobbling gate", prompt: "Super 8 home movie footage, warm faded colour", swatch: ["#24180e", "#b27a45", "#f3dcb0"], grain: 0.7, halation: 0.2, vignette: 0.45, gateWeave: 0.5, since: "0.3" },
];

export interface Lighting {
  id: string;
  label: string;
  prompt: string;
}

export const LIGHTING: Lighting[] = [
  { id: "natural", label: "Natural", prompt: "" },
  { id: "golden", label: "Golden hour", prompt: "warm golden-hour sunlight, long shadows" },
  { id: "blue_hour", label: "Blue hour", prompt: "blue-hour dusk light, city lights coming on" },
  { id: "neon", label: "Neon night", prompt: "neon-lit night, magenta and cyan signs reflecting on wet streets" },
  { id: "rembrandt", label: "Rembrandt", prompt: "Rembrandt key light, triangle of light on the cheek, dark background" },
  { id: "backlit", label: "Backlit haze", prompt: "strong backlight through haze, glowing rim light, volumetric rays" },
  { id: "overcast", label: "Overcast", prompt: "soft overcast daylight, no hard shadows" },
  { id: "firelight", label: "Firelight", prompt: "flickering warm firelight, deep surrounding darkness" },
  { id: "storm", label: "Storm", prompt: "stormy sky, lightning flashes, rain" },
];

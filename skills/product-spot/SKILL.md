---
name: product-spot
description: Make a product commercial or ad in NovaField - brief, product consistency, hero, macro and lifestyle shots, 6/15/30-second cuts in several aspect ratios, and an end card. Use when the person wants a product video, ad, commercial, e-commerce clip, launch teaser, or social ad for a product or brand.
---

# Product spot

A commercial sells one idea about one product. Read the `novafield-director` skill first for the
ground rules (plan, show the price, approval, `max_credits`) and the shot vocabulary.

## 1. Brief (ask, don't assume)

- **Product**: what it is, its exact colours, materials and finish, size, and the one feature to
  show.
- **The single message**: "lightest in its class", "made by hand", "lasts all day".
- **Audience and platform** → aspect and lengths: `16:9` web/TV, `9:16` Reels/TikTok/Shorts,
  `1:1` feeds. Common cuts: 6 s (bumper), 15 s, 30 s.
- **Tone**: premium and calm, playful, energetic, technical.
- **Brand rules**: colours, what must never appear, whether people may appear.
- **Real product photos**: needed. The product must look the same in every shot.

## 2. Make the product consistent

Register the product as an `object` asset with 4–8 clean photos (front, back, three-quarter,
detail, in hand) and a description of materials, colours and logo placement written once and
repeated in every prompt. Cast it in every shot (`cast: [{asset: …}]`).

Where a shot keeps getting the product wrong, keep the good footage and swap the product in with
`replace_object`: box the product (a moving box if it moves) and give the product photo as the
`picture`.

## 3. The shot menu

| Shot | Size / lens | Move | Light | Purpose |
|---|---|---|---|---|
| Hero reveal | full / 50 | `orbit_left` or `full_orbit`, `arc_in` | `backlit`, `rembrandt` | The product as the star |
| Macro detail | extreme_close / 85–135 | `creep_in`, `rack_focus`, `truck_right` 0.3 | `rembrandt`, `backlit` | Material and craft |
| Feature demo | medium / 35–50 | `push_in`, `locked` | `natural` | The one thing it does |
| In use (lifestyle) | medium–wide / 35 | `steadicam`, `handheld` 0.3 | `golden`, `natural` | The person it's for |
| Energy beat | close / 24 | `snap_push`, `whip_pan`, `crash_zoom` | `neon` | Pace and punctuation |
| Pack shot | medium / 50 | `locked` or `drift` | clean `natural` | Ends the spot; room for the end card |

Premium tends to mean slow moves, low intensity (0.4–0.7), `kodak_2383` or `fuji_eterna`, and
`rembrandt` or `backlit` light. Energetic tends to mean fast moves, `teal_orange` or
`technicolor`, and `neon`.

Set pieces: for tabletop shots, describe the surface and backdrop ("on wet black slate, soft
fog, black backdrop"), and keep it identical across shots.

## 4. Structure by length

- **6 s**: hook detail (2 s) → hero (2.5 s) → pack shot (1.5 s).
- **15 s**: hook (2) → feature demo (4) → lifestyle (4) → hero (3) → pack shot (2).
- **30 s**: problem or mood (4) → reveal (4) → 2–3 details (6) → in use (8) → hero (4) → pack (4).

Write the spot as a table (shot, seconds on screen, size/lens/move, prompt) and show it with the
plan prices before rendering.

## 5. Production

1. `plan_shot` every shot (`quality: "draft"`, the main aspect). Show the per-shot and total
   price; get approval and `max_credits`.
2. `generate` into a project named after the product; hero and macro shots get `takes: 3`.
3. Review against the product photos: shape, colour, logo, proportions. Fix with a clearer
   prompt, a closer size, or `replace_object`.
4. Keepers at `master`, same seeds (approval again).
5. Other aspect ratios are new renders with the same prompts, seeds and moves; frame the product
   centrally in `9:16`.

## 6. Edit and end card

- Cut on motion; 1.5–3 s per shot for 15 s spots, a little longer for 30 s.
- End on the pack shot with space for the logo. NovaField doesn't set text: add the logo, claim
  and legal lines in the person's editor, and leave the last 2 s clean for them.
- `assemble_film` per cut. With a music bed: `soundtrack: {file, mix: "replace"}`, or `"under"`
  to keep product sounds (the click, the pour) beneath the music.
- Deliver every cut and aspect with its length and the shot list.

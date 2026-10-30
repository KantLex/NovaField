---
name: trailer
description: Cut a trailer, teaser or sizzle in NovaField - mostly from existing takes, with a few new money shots - structured in acts, trimmed to fast beats, and laid over music. Use when the person wants a trailer, teaser, promo, sizzle reel, recap, or a series or film announcement.
---

# Trailer

A trailer promises a film without telling it. Most of it can be cut from takes that already
exist; new renders are for the few shots it's missing. Read the `novafield-director` skill first
for the ground rules (plan, show the price, approval, `max_credits`).

## 1. Brief

- **What it's for**: a teaser (15–30 s, mood and one question), a trailer (60–120 s, story
  shape), or a sizzle (30–60 s, energy and variety).
- **Aspect and platforms**: match the film; add `9:16` cuts for socials if wanted.
- **Music**: the person's track (absolute path), its BPM and its structure (build, drop, hit
  points). Trailer music is cut to, not under.
- **Spoilers**: what must not be shown.

## 2. Pull the footage

`list_takes` for the project (`starred: true` first, then everything done). For each usable take,
note its id, length, what's in it, and its strongest 1–3 seconds (look at the poster or file).
Group them: world/establishing, characters, conflict, spectacle, quiet moments, the ending
image.

Only then list the **missing** shots: usually a title-card backdrop, a bigger spectacle shot, a
final button. Plan those (`plan_shot`, same look and cast as the film), show the price, get
approval, render.

## 3. Structure

| Act | Length (90 s) | Content | Cutting |
|---|---|---|---|
| Cold open | 0–10 s | One arresting image, held | One or two long shots, `drift`/`locked` |
| World | 10–30 s | Where and who; calm before | 3–4 s per shot, dissolves allowed |
| Turn | 30–40 s | The inciting moment; a hit in the music | A hard cut on the hit |
| Escalation | 40–75 s | Conflict, stakes, spectacle; accelerating | 2 s → 1 s → ½ s per shot |
| Breath | 75–80 s | One quiet, emotional beat | One held close-up |
| Button | 80–90 s | The final image or sting | One shot, then black for the title |

A teaser keeps only cold open → one tease → button.

## 4. New shots that trailers need

- Spectacle: `drone_reveal`, `aerial_orbit`, `fpv_dive`, `bullet_time`, `crash_zoom`.
- Faces in extremis: `close`/`extreme_close`, 85 mm, `push_in` or `snap_push`, hard light
  (`rembrandt`, `storm`, `backlit`).
- Title-card backdrops: slow, simple, dark: `drift`, `creep_in`, `locked`, `moonlight` or `noir`
  look, space for text.
- `sound: false` on all of them (the music replaces it).

## 5. Cut

Build the edit with `set_edit` in act order. Each clip takes its strongest moment via `in`/`out`.
Time the escalation to the music: with BPM known, clip length = beats × `60/BPM`, shrinking from
4 beats to 2 to 1 through the escalation. Use `dissolve` only in the world act; `cut` everywhere
else. Leave 1–2 s of a dark backdrop where the person will set title cards.

`assemble_film` with `soundtrack: {file, start, mix: "replace"}`. To keep a few takes' own sounds
for punctuation (a gunshot, a door), use `mix: "under"` with `volume: 0.7` and set `muted: true` on
every other clip in the edit.

## 6. Deliver

The MP4, the cut list (take ids, in/out, song time), and the places left for title cards and
copy, which the person sets in their editor since NovaField doesn't set text. Offer a 15 s and a
`9:16` version from the same takes.

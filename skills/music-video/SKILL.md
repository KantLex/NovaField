---
name: music-video
description: Make a music video (MV) in NovaField - from a song to a treatment, a beat-mapped shot list, shots timed to bars and sections, a cut on the downbeats, and the song laid over the finished film. Use when the person wants a music video, MV, lyric-free visualizer, performance video, or a video cut to a track (including vertical cuts for TikTok, Reels or Shorts).
---

# Music video

A music video is picture cut to a song. NovaField renders the shots, cuts them on the beat, and
lays the song over the finished film (`assemble_film` with a `soundtrack`). Read the
`novafield-director` skill first for the ground rules (plan, show the price, approval,
`max_credits`) and the shot vocabulary.

**Lip sync:** NovaField can't make a performer sing the actual lyrics in sync. Stage performance
so it doesn't need to: wide or backlit performance shots, silhouettes, singing away from camera,
hands on instruments, crowd and band shots, and close-ups between lines. Or make it a concept or
narrative video without mouthing. Say this before writing the treatment.

## 1. Get the song's map

You need, from the person or by measuring:

- **The audio file** (absolute path) for the soundtrack.
- **Tempo (BPM)** and time signature (assume 4/4).
- **Sections with timestamps**: intro, verse, pre-chorus, chorus, bridge, drop, outro.
- **Which part of the song** the video covers (full song, or a 15–60 s excerpt for socials) and
  where it starts in the file (`soundtrack.start`).

If you have a shell with ffmpeg, you can read the file's length (`ffprobe`); ask the person for
BPM and sections rather than guessing. A wrong tempo puts every cut off the beat.

Timing maths (4/4):
- one beat = `60 / BPM` s; one bar = `240 / BPM` s.
- At 120 BPM: beat 0.5 s, bar 2 s, 2 bars 4 s. At 90 BPM: bar 2.67 s. At 140 BPM: bar 1.71 s.
- Cuts land on bar lines (or every 2 bars in verses, every bar or half bar in choruses and drops).

## 2. Treatment

Propose one of these (or a mix) in a few lines, with a look:

- **Performance**: the artist and band in one or two striking locations; energy from the moves.
- **Narrative**: a small story (two to four scenes) that the chorus pays off; performance as
  punctuation.
- **Concept / visualizer**: one strong visual idea that evolves: a world, a transformation, a
  motif repeated with variations; no plot.

Lock the visual language: the `look` (e.g. `vhs_1989` for retro synth, `teal_orange` for pop,
`noir` for moody ballads, `technicolor` for playful, `moonlight` or `neon` lighting for
electronic), a palette, two to four locations (register as `location` assets), and the cast
(register the artist from their photos as a `character` asset; never invent a real artist's face).

Pick the **aspect** first: `16:9` (YouTube), `2.39:1` (cinematic), `9:16` (socials). A vertical
cut is a separate set of renders, not a crop. Plan both only if the person wants both.

## 3. Beat-mapped shot list

Lay shots on the song's timeline. For each section, choose an energy and a cutting rate:

| Section | Energy | Cut every | Sizes | Moves |
|---|---|---|---|---|
| Intro | build | 2–4 bars | wide, extreme_wide | `drift`, `drone_approach`, `crane_down`, `creep_in` |
| Verse | story | 2 bars | medium, close | `steadicam`, `truck_left`/`truck_right`, `push_in`, `handheld` 0.4 |
| Pre-chorus | lift | 1 bar | close, medium | `creep_in`, `spiral_up`, `pedestal_up` |
| Chorus / drop | peak | ½–1 bar | all, fast contrast | `snap_push`, `crash_zoom`, `whip_pan`, `orbit_left`/`orbit_right`, `fpv_dive`, `bullet_time` |
| Bridge | breath | 2–4 bars | extreme_close, wide | `locked`, `rack_focus`, `dolly_zoom`, `full_orbit` |
| Outro | release | 4 bars | extreme_wide | `pull_out`, `drone_reveal`, `crane_up` |

Write it as a table and show it:

| # | Section | Song time | Bars | On screen (s) | Shot (size / angle / lens / move) | Prompt | Cast |
|---|---|---|---|---|---|---|---|
| 1 | Intro | 0:00–0:08 | 4 | 8.0 | extreme_wide / high / 24 / `drone_approach` | … | — |

Render length vs screen time: render each shot a little longer than it plays (5–8 s) and trim in
the edit. Shots over 15 s don't exist; long sections are several shots.

Repeat motifs on purpose: the same location or move in every chorus, with something changed
each time (lighting, time of day, more people).

## 4. Rendering

- `sound: false` on every shot: the song replaces the takes' sound, so don't spend effort on it.
- `quality: "draft"` for the whole list first; `studio`/`master` for the keepers later, same seed.
- Chorus shots get `takes: 2`: you'll want options for the fastest cuts.
- Plan everything (`plan_shot`), show the per-shot and total price, get approval and
  `max_credits`, then `generate` in batches into a project named after the song.
- Continuous motion across a cut (a dancer's spin, a car's run): `continue_from` the previous
  take.
- Performance identity: if the artist's face drifts, `recast` the take with the artist asset.
- Stylised videos: render plainly, then `restyle` every keeper with the **same** style words and
  style picture (see the `henshin` skill) so the whole video shares one look.

## 5. Cutting on the beat

Build the edit with exact in/out points so each clip lasts a whole number of bars (or beats):

```
bar = 240 / BPM
clip length = bars × bar     (e.g. 2 bars at 120 BPM = 4.0 s)
in  = where the best part of the take starts (often 0.3–1.0 s in)
out = in + clip length
```

`set_edit` with `{take, in, out, join: "cut"}` for each shot in song order. Use `dissolve` only
in the intro, bridge or outro. Check `get_edit`: its running length should equal the song part you
cover (dissolves shorten it by half a second each; compensate on the next clip).

Then `assemble_film` with:

```
soundtrack: { file: "/abs/path/song.wav", start: <seconds into the file where the video starts>, mix: "replace" }
```

The film keeps the picture's length, and the music fades over the last second. If the cut feels
early or late against the music, shift `soundtrack.start` by a beat (`60/BPM`) rather than
re-cutting everything.

## 6. Deliver

- The MP4 URL, the shot list with song times, and the BPM and bar maths you used.
- Offer: a 9:16 social cut of the chorus (new renders at `9:16`, same seeds and prompts, cut to
  15–30 s), a `master`-quality pass on the starred shots, and an alternate cut of the chorus.

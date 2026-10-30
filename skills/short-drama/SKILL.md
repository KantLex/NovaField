---
name: short-drama
description: Make a vertical short drama series (micro-drama, 短剧) in NovaField - a series bible, recurring cast, episodes of 60 to 120 seconds built on a hook, escalation and cliffhanger, shot lists, continuity across episodes, and one assembled film per episode. Use when the person wants a short drama, web series, vertical drama, soap, or episodic story for TikTok, Reels, Shorts, ReelShort-style apps or Douyin.
---

# Short drama

A short drama is a series of vertical episodes, each 60–120 s, that hooks in the first three
seconds and ends on a cliffhanger. NovaField can do the picture end to end: recurring cast,
locations, continuous action across cuts, and a cut episode. Read the `novafield-director` skill
first for the ground rules (plan, show the price, approval, `max_credits`) and the shot vocabulary.

**What NovaField can't do:** speak your exact lines in sync with lips. The sound a model generates
isn't scripted, so it can't be relied on for dialogue. Plan dialogue as subtitles or a voice-over that
the person adds in their editor, and stage talking shots so lip sync doesn't matter: over the
shoulder, backs to camera, wide two-shots, reactions, hands, phones, glances. Say this up front.

## 1. The series bible (once, before any episode)

Agree these with the person and keep them in a short document you can reuse every episode:

- **Logline**: one sentence: who wants what, and what stands in the way.
- **Genre and tone**: revenge, romance, CEO, mystery, family, fantasy, horror, comedy…
- **Episode count and length**: e.g. 10 × 90 s. Drafts first; one episode end to end before
  committing to the series.
- **Cast**: for each character, a name, a `@Handle`, age, build, face, hair, and a **fixed
  wardrobe line** written once and pasted into every prompt they appear in, e.g. "charcoal wool
  coat over a white shirt, silver watch". Register each as a character asset with 3–6 clear
  pictures (`register_asset`, kind `character`, description = that line). If the person has no
  pictures, make them with an image workflow (`list_engines` → `run_workflow`) or the
  `character-sheet` skill, then register the best.
- **Locations**: 3–6 recurring sets (office, rooftop, apartment, hospital corridor, street at
  night). Register each as a `location` asset with its description; repeat that description
  verbatim in prompts.
- **Look**: one `look` and lighting plan for the series, e.g. glossy romance → `kodak_2383` and
  `golden` or `natural`; revenge or thriller → `bleach_bypass` or `teal_orange`, `overcast`,
  `neon` at night; horror → `moonlight`, `storm`, `firelight`.
- **Aspect**: always `9:16`.

Create a project per episode (`organise_takes create_project: true`, named like
"Ep 03 The Contract"): each project has its own edit.

## 2. Writing an episode

Every episode follows the micro-drama beat sheet (seconds for a 90 s episode):

| Beat | Time | Job |
|---|---|---|
| Hook | 0–3 s | A shocking image or line mid-action: a slap, a ring thrown, a stranger in the doorway |
| Recap / setup | 3–10 s | Where we are, from the last cliffhanger |
| Escalation 1 | 10–35 s | The conflict sharpens; a reversal |
| Escalation 2 | 35–65 s | Higher stakes; a secret surfaces |
| Climax | 65–80 s | The confrontation or reveal |
| Cliffhanger | 80–90 s | A question the next episode answers; end on a face or an object |

Write the episode as beats, then a **shot list table** and show it to the person before planning:

| # | Beat | Size / angle / lens | Move | Dur | Prompt (with @Handles and wardrobe lines) | Cast | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Hook | close / low / 50 | `snap_push` | 3 | @Lin throws the ring onto the marble floor… | Lin | continue → 2 |

Pacing: 1.5–4 s per shot on screen, 20–40 shots per 90 s episode. Takes are usually 5 s; trim
them in the edit. Use 2–3 shot sizes per scene: a wide or full master to place everyone, mediums
for exchanges, and closes for reactions. Reactions sell short drama.

## 3. Shooting style that works vertically

- **Frame for 9:16**: one subject per frame, centred or in the upper third; stack two people
  vertically (one in the foreground, one behind) rather than side by side.
- **Sizes**: mostly `medium` and `close`; `extreme_close` on eyes, hands and objects (the ring,
  the contract, the phone screen); a `wide` only to establish a location.
- **Moves**: `push_in` and `creep_in` for building emotion; `snap_push` or `crash_zoom` for
  slaps, reveals and shocks; `handheld` (intensity 0.4) for arguments; `orbit_left` /
  `orbit_right` around a couple; `hero_rise` (low angle) for the moment someone takes their
  power back; `locked` for cold, formal scenes.
- **Lenses**: `50`/`85` for faces, `35` for two-shots, `24` for rooms.
- **Angles**: `low` for whoever has power in the scene, `high` for whoever's losing; `dutch`
  sparingly for betrayal or madness.
- **Dialogue staging** (no lip sync): over-the-shoulder on the listener, the speaker's back,
  reactions, two-shots wide enough that mouths are small, inserts of hands and objects.
- **Sound**: leave `sound: true` for room tone and effects, and add music under it in
  `assemble_film`, or in the person's editor with the dialogue.

## 4. Continuity

- Cast the same character asset in every shot they appear in, and paste their wardrobe line
  every time. A wardrobe change is a deliberate new line in the bible.
- **Continuous action across a cut** (she stands, walks to the window, turns): render the first
  shot, then `continue_from` its take for the next. The second starts on the first's last
  frames.
- **180° rule**: keep the camera on one side of a conversation for the whole scene.
- **Face drift**: if a shot's face isn't quite the character, don't re-roll forever: `recast` the
  take with the character asset (notes can keep wardrobe and lighting).
- **Same light within a scene**: one `lighting` per scene. Night scenes stay night.
- Keep a continuity note per shot (props in hand, which hand, wet or dry, time of day).

## 5. Production loop for one episode

1. `status` → GPU online, queue length.
2. Plan every shot (`plan_shot`, `aspect: "9:16"`, `quality: "draft"`), and collect the prices
   into one table: per shot and in total. Show it. Get approval and the `max_credits` ceiling.
3. Render in batches of 4–8 (`generate`, `project` = the episode). Hook shots and the cliffhanger
   get `takes: 2–3`.
4. `get_take wait_seconds` each; review with the person; star keepers; re-plan the misses with a
   changed prompt or move (not just a new seed, unless it was close).
5. Rough cut: `set_edit` with clips trimmed to their best 1.5–4 s, `cut` everywhere except a
   `dissolve` for time jumps. `get_edit` reports the running length; aim for the target ±10 s.
6. `assemble_film` → the episode MP4. Offer a final pass: re-render the starred shots at
   `studio` with the same seed (approval again), swap them into the edit, and assemble again.
7. Hand over: the MP4 URL, plus the shot list with the subtitle or voice-over lines per shot for
   their editor.

## 6. Across the series

- Start each episode's planning by re-reading the bible and the last episode's cliffhanger.
- Keep openers and endings consistent: same cold-open style, and the cliffhanger always lands on
  a close-up.
- After episode 1, ask what to change in the bible (cast pictures, look, pacing) before shooting
  more. It's cheaper to change direction early.
- A trailer for the series: see the `trailer` skill, cut mostly from existing takes.

---
name: script-to-film
description: Turn a script, story, treatment or idea into a finished short film in NovaField - break it into scenes and beats, plan coverage and a shot list, cast and locations, render, review and cut. Use when the person has a script or story (or just an idea) and wants a short film, scene, sequence, animatic or proof of concept.
---

# Script to film

From words on a page to an assembled short. Read the `novafield-director` skill first for the
ground rules (plan, show the price, approval, `max_credits`) and the shot vocabulary.

## 1. Read the material

If the person gives only an idea, write a one-page script with them first: scene headings
(INT./EXT. PLACE, TIME), action in the present tense, and short dialogue. Then agree on:

- **Length**: 1–3 minutes is a good first film (15–45 shots).
- **Aspect**: `16:9`, or `2.39:1` for a cinematic feel; `9:16` for socials.
- **Tone and look**: two or three reference films, then a NovaField `look` and lighting plan per
  scene (see the `lookbook` skill to build one from reference images).
- **Dialogue**: NovaField won't lip-sync your lines. Write dialogue as subtitles or a voice-over
  to add later, and stage talking shots accordingly (over the shoulder, reactions, wider
  two-shots).

## 2. Break it down

For each scene, list:

- **Characters** → `character` assets (pictures plus a fixed wardrobe line; see
  `character-sheet` if there are no pictures yet).
- **Location** → a `location` asset with a description you'll repeat verbatim.
- **Props that matter** → `object` assets (the letter, the gun, the car).
- **Time of day and weather** → `lighting` (`golden`, `blue_hour`, `overcast`, `storm`…).
- **Beats**: each change in what a character wants or knows. Each beat needs at least one shot.

## 3. Coverage: choose shots like a director

For each beat, pick the shot that tells it best and give it a reason:

- **Establish** where we are: `extreme_wide`/`wide`, 24 mm, `drone_approach`, `crane_down`,
  `pull_out` or `locked`.
- **Master** the action: `full` or `wide`, 35 mm, `steadicam` or `locked`.
- **Singles** for each character's beat: `medium` → `close`, 50–85 mm, `push_in` as feeling
  builds, `creep_in` for menace.
- **Reactions**: `close`, 85 mm, `locked` or a slow `push_in`. Often stronger than the line.
- **Inserts**: `extreme_close` on the object that matters, 85–135 mm, `rack_focus`.
- **Transitions**: an object or motion that bridges two scenes; a `dissolve` for time passing.

Rules of thumb: change size or angle between consecutive shots of the same subject (a jump cut
looks like a mistake); keep the 180° line in a dialogue scene; low angle for the one in control,
high for the one losing; save the most aggressive moves for the turning point.

## 4. The shot list

Write it as a table, show it, and adjust with the person before any planning:

| # | Scene / beat | Size / angle / lens | Move (intensity) | Dur | Prompt | Cast / location | Continuity |
|---|---|---|---|---|---|---|---|

Prompts: one action, present tense, concrete. Mention the character by `@Handle`, the wardrobe
line, the location description, and anything carried over from the last shot ("still holding the
letter in her left hand").

## 5. Previs (optional, recommended for complex blocking)

- **A preset or stacked move** is enough for most shots.
- **Hand-blocked**: for a precise path, write a `rig` (read `novafield://camera/contract`), or
  export a camera from Blender (`rig_file`, NovaField ships an exporter in `samples/`).
- **Your own footage**: a phone walk-through or a Blender playblast as `previs.file`
  (`follow: "action"` copies the blocking too).
- **Animatic first**: render the whole list as fast drafts (`quality: "draft"`, short
  durations), cut it, watch it with the person, and only then render properly.

## 6. Production

1. `status`; create the project (`organise_takes create_project: true`).
2. `plan_shot` every shot; one table of prices (per shot and total). Approval and `max_credits`.
3. `generate` in scene order, in batches of 4–8; key shots get `takes: 2–3`.
4. Continuous action across a cut: `continue_from` the previous take. Same camera as an earlier
   shot: `previs: {take: …}`.
5. Review each take with the person (`get_take`); star keepers; re-plan misses by changing the
   prompt, move or size, not just the seed. Fix face drift with `recast`.
6. Final quality: re-render the starred shots at `studio`/`master` with their seeds (approval
   again, it costs more GPU time).

## 7. Edit

- `set_edit` in script order, every clip trimmed (`in`/`out`) to its strongest moment. Most
  shots play 2–5 s.
- `cut` within a scene; `dissolve` between scenes for time passing.
- Let reactions breathe; cut out of action shots early.
- `get_edit` for the running time; `assemble_film` for the MP4. Add a score with
  `soundtrack: {file, mix: "under", volume: 0.6}` if the person has one.
- Deliver the MP4, the final shot list, and the dialogue or subtitle lines per shot.

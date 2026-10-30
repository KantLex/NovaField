---
name: score-and-voice
description: Add music and voice to NovaField films - generate a score or song with an audio workflow, narration or voice-over with a text-to-speech workflow, and lay it over the cut with the right timing and mix. Use when the person wants music, a score, a jingle, narration, voice-over, a soundtrack, or sound for a film they made in NovaField.
---

# Score and voice

NovaField renders picture; sound comes from three places: the takes' own generated sound, audio
workflows on ComfyUI (music, speech), or files the person already has. Read the
`novafield-director` skill first for the ground rules (plan, show the price, approval,
`max_credits`) and `comfy-workflows` for finding and importing workflows.

## 1. What NovaField does and doesn't do with sound

- `assemble_film` lays **one** soundtrack over the whole film: `soundtrack: {file, start, mix,
  volume}`. `mix: "replace"` makes it the only sound; `"under"` keeps the takes' sound, lowered,
  beneath it. It fades out over the last second.
- Per clip you can only keep or mute the take's own sound (`muted` in the edit).
- There is no multi-track mixer: music **and** a voice-over together need to be one file first.
  Mix them in the person's editor, or, if you have a shell with ffmpeg and the person agrees, mix
  the two files into one (voice at full level, music about 12 dB lower) and use that as the
  soundtrack.
- Lip-synced dialogue isn't possible; voice-over and narration work well.

## 2. Music

Check `list_engines` for an audio workflow; if there's none, `find_workflows` with
`media: "audio"` and offer a short menu (local first). Import the pick.

Write the brief before generating:
- **Length**: the film's running time (`get_edit` → seconds) plus 2–3 s.
- **Tempo and energy**: match the cut (fast cuts → 110–140 BPM; slow, emotional → 60–90 BPM).
- **Genre, instruments, mood**, and where it should build or drop (e.g. "builds at 0:20, peaks at
  0:45").
- Instrumental unless the person wants a song.

`run_workflow` with `plan_only` (role `prompt`, plus seconds or duration fields if the workflow has
them), show the price, get approval, run. The result is an audio take. Generate 2–3 versions with
different seeds and let the person choose.

Use it: `soundtrack.file` must be a local path, so save the audio take's URL (from `get_take`) to a
local file first (or ask the person to download it), then `assemble_film` with
`soundtrack: {file: "<that path>", mix: "replace"}`.

Music video timing works the other way round: cut the picture to the music (see `music-video`).

## 3. Voice-over and narration

Find a text-to-speech workflow the same way (`media: "audio"`, words like "speech", "TTS",
"voice"). Write the script per shot first, timed to the edit:

| Shot | In (film time) | Line | Max length |
|---|---|---|---|
| 1 | 0:00 | "Every city has a sound." | 2.5 s |

Rule of thumb: about 2.5 spoken words per second. Leave space: lines shouldn't fill whole shots.

Generate the narration as one file (or line by line and join them), then mix it with any music
into one soundtrack (see the note above) and assemble with `mix: "replace"`, or `mix: "under"`
to keep the takes' ambience beneath it.

Voices of real people: only clone or imitate a real person's voice with their permission.

## 4. Deliver

The film with sound, the music and voice files, the script with timings, and the settings and
seeds of each generation so they can be redone.

---
name: novafield-director
description: Direct shots in NovaField through its MCP tools - plan, price, render, review, organise and cut takes into a film. Use whenever the person wants to make video or stills with NovaField, or before any other NovaField skill (script-to-film, short-drama, music-video, product-spot, ad-campaign, social-series, trailer, one-take, storyboard-animatic, photo-to-video, character-sheet, lookbook, henshin, comfy-workflows, score-and-voice). Covers the ground rules, every tool, the camera vocabulary and the plan-approve-render loop.
---

# NovaField director

NovaField is a film studio on ComfyUI. You direct it through the `novafield` MCP tools: shots with
real camera direction (moves, lenses, a ghost-rig previs the model follows), a cast and asset
library, imported ComfyUI workflows, Henshin transforms of existing footage, and an editor that cuts
takes into a film. The app must be running (`pnpm dev`); `status` tells you if it is.

## Ground rules (never skip these)

1. **Plan before you render.** `plan_shot`, and `plan_only: true` on `run_workflow`, `recast`,
   `restyle`, `replace_object` and `animate_still`, are free. They return what the render will make
   (length, size), any blocker, and the price in API credits.
2. **Show the plan and get a clear yes.** Before anything renders, show the person the settings
   and the cost, per shot and in total for a batch, and wait for an explicit approval. A request
   like "make a music video" is not approval of a specific plan.
3. **`max_credits` is the approved ceiling.** Every render needs it. Use the total the person
   approved. `0` means local GPU only, so anything with paid API nodes is refused. Never raise it
   without asking.
4. **The GPU is shared.** A local ComfyUI may be running other people's work. Queue in reasonable
   batches (about 4 to 8 renders), check `status` for the queue, and say how many renders are
   ahead. Only `cancel_take` takes you started yourself.
5. **Say what's happening.** After a batch, report each take's status, any error in plain words,
   and the credits actually spent (the `credits` field in the reply).
6. **Never delete the person's work.** There's no delete tool on purpose. Organise with projects
   and stars instead.
7. **Say before you start a long batch.** Renders take minutes each. Before queuing, say how many,
   roughly how long (check the queue in `status`), and that you'll report back.
8. **Speak the person's language**, and use plain words for models and settings, not ids.

## Choosing the model

MiniMax H3 is the built-in video engine (camera direction, cast, ghost rig, film lab). When the
person wants something else, or a still, `list_engines` shows what's imported. When it isn't there
yet, `find_workflows` and offer a short numbered menu with what each is good at, local or paid,
and a recommended default; wait for their pick, then `import_workflow` (see `comfy-workflows`).

## The loop

```
status                      → is ComfyUI online, which GPU, what's in the queue, what's installed
list_assets / list_engines  → what you can cast, and which models exist (H3 + imported workflows)
plan_shot (×N)              → shot list with prices; show it; get approval
generate (max_credits)      → queued takes
get_take (wait_seconds)     → follow each take to done; read errors
organise_takes              → a project per piece, star the keepers
set_edit / get_edit         → the cut, with in/out points and dissolves (the person sees it live)
assemble_film               → one MP4 (local ffmpeg, free), optionally with a soundtrack
```

Drafts first: `quality: "draft"` is fast. Once the person likes a shot, re-render the keeper at
`studio` or `master` with the **same seed** (plan_shot returns it) so it stays the same shot.

## Tools

| Tool | Use it for |
|---|---|
| `status` | Online or not, local GPU or Comfy Cloud, GPU memory, queue, API key, installed engines |
| `list_engines` | MiniMax H3 (built-in video) and every imported workflow: output kind, local or paid, field roles |
| `plan_shot` | A shot compiled and checked without rendering. Free |
| `generate` | Render a shot (1–4 variations via `takes`). Needs `max_credits` |
| `run_workflow` | Run an imported workflow by role (`prompt`, `image`, `seed`…), e.g. an image model for stills. `plan_only` first |
| `find_workflows` / `import_workflow` | ComfyUI's template library and saved workflows; import one as an app (and a Studio model) |
| `take_frame` | A frame of a video take (last, or `at` seconds) as a picture: keyframes, thumbnails, stills |
| `get_take` / `list_takes` | Status, progress, errors and file URLs; `wait_seconds` (up to 600) waits for it to finish |
| `cancel_take` | Stop a take you started |
| `list_assets` / `register_asset` | The cast library: characters, objects, locations, styles, clips. Files are local paths or a take's URL |
| `list_projects` / `organise_takes` | A project per film or episode (each has its own edit); star keepers |
| `get_edit` / `set_edit` | The timeline: clips with `in`/`out` seconds, `cut` or `dissolve`, `muted` |
| `assemble_film` | Cut the edit into one MP4. `soundtrack: {file, start, mix, volume}` lays music over it |
| `recast` | Henshin: swap the person in a clip for a character; motion, timing and camera stay |
| `restyle` | Henshin: re-render a clip in a new look, shot for shot |
| `replace_object` | Henshin: track a box over a thing and turn it into something else |
| `animate_still` | Henshin: bring a still to life along drawn paths, with optional camera-like frame moves |

Resources: `novafield://camera/moves` (every move, size, angle, lens, light and look),
`novafield://camera/contract` (writing a camera rig by hand), `novafield://specs` (job types).

## Writing a shot

`plan_shot` / `generate` take:

- **prompt**: what happens, in the present tense, concrete and visual. One action per shot. Name
  cast members with `@Handle` (from `list_assets`) and pass their pictures in `cast`. Describe
  wardrobe and props the same way, word for word, in every shot they appear in.
- **size**: `extreme_wide`, `wide`, `full`, `medium`, `close`, `extreme_close`.
- **angle**: `eye`, `low` (power), `high` (vulnerable), `overhead`, `dutch` (unease).
- **lens** (mm): `14` (vast, distorted), `24` (environment), `35` (natural, default), `50`
  (intimate), `85` (portrait, soft background), `135` (compressed, voyeur).
- **move**: a preset (below), or `combo` to stack moves (`{id, intensity, when: whole|start|end}`),
  or a hand-written `rig`, or `rig_file` (a camera-path JSON, e.g. from Blender), or `previs` (your
  own blockout clip, phone footage or animatic; the model follows its camera).
- **intensity**: `0.3` subtle, `1` normal, `1.6` aggressive.
- **lighting**: `natural`, `golden`, `blue_hour`, `neon`, `rembrandt`, `backlit`, `overcast`,
  `firelight`, `storm`.
- **look** (film stock, graded on the GPU): `none`, `kodak_2383` (warm cinema), `fuji_eterna`
  (soft, muted), `bleach_bypass` (harsh, desaturated), `teal_orange` (blockbuster), `noir` (black
  and white), `technicolor` (saturated classic), `moonlight` (cold night), `vhs_1989`, and with
  NovaField nodes 0.3.0 on the server: `kodak_portra_400` (warm skin, soft), `kodak_vision3_500t`
  (tungsten cinema negative), `ektachrome_e100` (clean slide), `cinestill_800t` (night, red glow),
  `fuji_velvia_50` (vivid), `kodachrome_64` (classic warm), `ilford_hp5` (soft black and white),
  `instant_film` (faded), `super8` (home movie). On an older server those are only described in the prompt.
- **aspect**: `16:9`, `9:16` (vertical: shorts, drama, socials), `1:1`, `2.39:1` (scope), `4:3`.
- **duration**: 1–15 s (default 5). **quality**: `draft`, `studio`, `master`.
- **sound**: `true` (default) lets the model make sound; turn it off when music will replace it.
- **start_frame / end_frame**: pin the first or last frame to a picture. Any picture input takes a
  library asset, a local file, or a take: `{take: id}` (an image take, or a video take's last
  frame) or `{take: id, at: 2.5}` for a moment in it.
- **smooth**: interpolate to 48 fps for smoother motion (when `status` caps show `interpolate`).
- **continue_from**: a finished take's id. The new shot starts on that take's last frames, so the
  two cut together as one continuous action (MiniMax H3 only).
- **engine**: render through an imported workflow (id from `list_engines`) instead of MiniMax H3.
- **seed**: keep it to re-render the same shot at higher quality.

### Camera moves by intent

| Intent | Moves |
|---|---|
| Calm, observational | `locked`, `drift`, `steadicam`, `panorama` |
| Tension, dread | `creep_in`, `dolly_zoom`, `dutch_roll`, `handheld` (low intensity) |
| Reveal | `pull_out`, `crane_up`, `drone_reveal`, `tilt_up`, `pedestal_up`, `arc_out` |
| Intimacy, focus | `push_in`, `rack_focus`, `zoom_in`, `arc_in` |
| Energy, impact | `snap_push`, `crash_zoom`, `whip_pan`, `whip_pan_left`, `fpv_dive`, `barrel_roll`, `earthquake` |
| Following action | `truck_left`, `truck_right`, `ground_glide`, `diagonal`, `steadicam` |
| Hero, power | `hero_rise` (low angle), `orbit_left` / `orbit_right`, `spiral_up` |
| Spectacle | `aerial_orbit`, `drone_approach`, `overhead_rise`, `bullet_time`, `full_orbit` |

Read `novafield://camera/moves` for all 49 and how to stack them.

## Continuity toolkit

- **Same face everywhere**: register the character once (`register_asset`, several clear
  pictures, a description of age, build, hair and wardrobe); cast it in every shot. If a face
  drifts, `recast` the shot with the character.
- **Continuous action across a cut**: `continue_from` the previous take.
- **Matching a camera**: `previs: {take: …}` copies a take's camera onto a new shot.
- **Same look**: one `look` and `lighting` per scene; repeat the location's description verbatim.
- **Screen direction**: keep the camera on one side of the action (the 180° rule): if a character
  walks left to right, keep them left to right through the scene.

## Reviewing takes

`get_take` returns the video, poster and image URLs. Look at the poster or file when you can, and
judge it with the person. Make variations (`takes: 2–4`) for the shots that matter most, star the
keeper (`organise_takes starred: true`), and keep the rest. Failed takes carry an `error`; explain
it in plain words and propose a fix (a blocker such as a missing node pack, an unclear prompt, or
too long a shot) instead of retrying blindly.

## Cutting

`set_edit` takes take ids or clips `{take, in, out, join, muted}`. Trim each clip to its best
part, since 5 s takes rarely play whole. Use `dissolve` for time passing and `cut` everywhere
else. `assemble_film` makes the MP4 locally with no GPU and no credits. With `soundtrack` the
music plays over the whole cut: `mix: "replace"` for music videos and trailers, `"under"` to keep
the takes' sound beneath it.

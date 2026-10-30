---
name: storyboard-animatic
description: Turn a scene into a storyboard of keyframes and then a moving animatic in NovaField - draw each panel with an image workflow, approve the boards, animate between keyframes with start and end frames or motion paths, and cut it to time. Use when the person wants a storyboard, boards, keyframes, an animatic, a pre-vis of a scene, or to lock the composition of every shot before rendering video.
---

# Storyboard → animatic

Boards decide composition cheaply. Stills cost a fraction of video, so agree every frame first,
then move them. Read the `novafield-director` skill first for the ground rules (plan, show the
price, approval, `max_credits`) and the shot vocabulary.

## 0. What you need

- An image model: `list_engines` → a workflow with output `image`. If there's none,
  `find_workflows` with `media: "image"` (add `local_only: true` to avoid paid API nodes), show the
  choices with what each is good at and a recommended default, and `import_workflow` the one the
  person picks.
- MiniMax H3 for the moving shots (`status` → `caps.h3`).

## 1. Beat the scene into panels

For each beat write one panel: shot number, size, angle, lens, what we see, and the action that
happens *during* the shot. Two to four panels per beat for key moments; one for transitions.
Keep the 180° line, vary sizes between neighbouring panels, and mark where the camera moves.

| Panel | Size / angle / lens | Frame (what we see) | Action during the shot | Move |
|---|---|---|---|---|
| 1A | wide / high / 24 | Empty platform at night, one bench | A tram pulls in | `drift` |
| 1B | close / eye / 85 | @Mira's face, rain on the glass | She looks up | `push_in` |

## 2. Draw the boards

For each panel, `run_workflow` the image workflow with `plan_only: true` first, using the
`prompt` role (the frame description + style words) and the aspect you'll shoot in. Collect the
prices for the whole board into one table, get approval, then run it in batches.

Consistency across panels:
- Cast the same character pictures where the workflow has image inputs (pass them via `files`);
  repeat each character's wardrobe line and the location description word for word.
- One style line for the whole board ("cinematic film still, 35 mm, muted teal and amber").
- Same seed family per scene when the workflow exposes a seed.

Show the boards in order with the panel table. Redraw panels until the person signs off. The
boards are the contract for the video.

## 3. From boards to motion

Pick the right way to move each panel:

| Panel needs | Use | How |
|---|---|---|
| A known start and a known end | `generate` with `start_frame` and `end_frame` | Board A as start, board B (the next panel of the same shot) as end; the prompt describes the motion between |
| Only a start; the action is free | `generate` with `start_frame` | Prompt the action; pick a move that matches the board's arrow |
| Precise local motion on a still (water, cloth, a car's path) | `animate_still` | Paths on the board; pin what mustn't move |
| Continuous action into the next panel | `continue_from` | The next shot starts on the last frames of this one |

Pictures can be a board's image take: `start_frame: {take: "<image take id>"}`. To start from a
moment of a video take, use `{take, at}` or `take_frame`.

Animatic settings: `quality: "draft"`, durations that match the panel's screen time (2–5 s),
`sound: false` unless the scene needs it. Plan the whole set, show the total, get approval, render.

## 4. Cut the animatic

`set_edit` in panel order, each clip trimmed to its planned screen time. For panels you didn't
animate, the still can sit in the cut as a short "hold" by animating it with a `locked` move or
`animate_still` with only pins. Dissolve between scenes only. `assemble_film`, with a temp music
or voice track via `soundtrack` if the person has one.

## 5. Hand over

The animatic MP4, the board images with panel numbers, and the panel table. When the person
approves, render final shots at `studio`/`master` from the same boards (same start and end frames,
same seeds), or go on with `script-to-film`.

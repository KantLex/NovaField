---
name: henshin
description: Transform existing footage and stills with NovaField's Henshin tools - recast a person into a character, restyle a clip into a new look shot for shot, replace an object with box tracking, and animate a still along drawn motion paths. Use when the person wants to change who is in a clip, change its style or medium, swap or remove a thing in it, bring a photo or illustration to life, or fix face drift in rendered takes.
---

# Henshin: transform footage

Four tools that keep what's good about a clip (motion, timing, camera) and change the rest.
Read the `novafield-director` skill first: every Henshin tool follows the same rule. Run it with
`plan_only: true` (free), show the result and price, get approval, then run with `max_credits`.

A source clip can be a take (`{take: id}`), a library clip asset (`{asset: id}`), or a local file
(`{file: "/abs/path.mp4"}`). Pictures are an asset (`{asset, items}`) or a file.

## Which tool

| The person wants… | Tool | Engine and limits |
|---|---|---|
| A different person in the clip; same performance | `recast` | MiniMax H3 reference-to-video; source 2–15 s |
| The clip in another medium or look (anime, clay, painting, a film stock) | `restyle` | MiniMax H3; source 2–15 s |
| One thing in the clip turned into something else | `replace_object` | Wan 2.1 VACE at 16 fps; the first 5 s |
| A still that moves the way they draw it | `animate_still` | WanMove + Wan 2.1 image-to-video; 5 s, the still's shape |

## recast

- `character`: the new lead's picture. One clear, front-facing, full-body picture is best; a
  registered character asset is ideal.
- `extras` (up to 3): other people or props in the clip that should also follow references.
- `notes`: direction that can also change wardrobe, lighting or background: "keep the red
  umbrella, make it night", "same outfit, sunset light".
- `audio`: `original` keeps the clip's sound; `generated` makes new; `none`.

Uses:
- **Lock a face across a film**: render shots with any figure, then recast each to the character.
- **Fix drift**: a great take with the wrong face → recast it, don't re-roll it.
- **Your own footage**: film yourself acting the scene on a phone, then recast to the character.
- Recast needs the person reasonably visible in the source; tiny distant figures and heavy
  occlusion recast poorly.

## restyle

- `style`: the new look in words: medium, texture, palette, era. "Stop-motion claymation with
  felt textures and visible fingerprints", "1970s hand-painted anime cel, soft pastel
  backgrounds".
- `style_picture`: a picture in that style (a frame, a painting, a style asset item).
- `look`: a film stock graded on the GPU afterwards (`noir`, `kodak_2383`, … or `none`).

For a whole film in one style: use **exactly the same** style words, style picture and look on
every clip, and restyle the final keepers only. Restyle is the most reliable way to get extreme
styles consistently: shoot plainly, restyle as a pass.

## replace_object

- `boxes`: where the thing is, as fractions of the frame (`x`, `y` = top-left corner; `w`, `h` =
  size), each with `at` (seconds). One box for something still; boxes at several moments for
  something that moves. The box eases between them. Add a box wherever the motion turns.
- `shape`: `rect` or `ellipse` (round things, faces).
- `becomes` (words) and/or `picture` (what it turns into).

Placing boxes: look at the clip first (the take's `poster`, or frames from the file if you can
extract them) and estimate the thing's bounds, with a little margin. If you can't see the clip,
ask the person to describe where the thing is ("lower left, about a fifth of the frame") or to
draw the box in the app's Henshin page. Uses: product placement (swap a stand-in bottle for the
real product), changing a prop, turning a car into a horse-drawn cart.

## animate_still

- `image`: the still (photo, illustration, generated frame).
- `paths`: each `{points: [[x, y], …], start, end, ease}` in 0–1 picture coordinates. The thing
  under the first point travels along the line. Timing (`start`/`end` as fractions of the 5 s)
  lets things move one after another. `ease`: `smooth`, `linear`, `in`, `out`.
- **Pins**: a path with a single point holds that thing still. Pin what must not move (a
  building, a face, the horizon).
- `frame_move`: `pan_left`, `pan_right`, `tilt_up`, `tilt_down`, `push_in`, `pull_out` moves
  the whole picture like a camera (adds 9 grid points; up to 24 paths in all).
- `prompt`: what happens ("the paper boat drifts down the stream as leaves fall").

Uses: storyboard frames to animatic, illustrations and photos for music videos, product stills
with gentle motion, establishing shots from concept art. Draw few, clear paths. Opposing paths
close together tear the picture.

## Workflow

1. Identify the source and what must stay the same; say it back to the person.
2. `plan_only` the transform; show what it makes and the price.
3. On approval, run it (`max_credits`, `project`).
4. `get_take` (wait) → review against the source with the person. Henshin results are takes:
   star, trim and cut them like any other.
5. For a series of clips (a whole film), plan all of them, show the total, get one approval, run
   in batches of 4–8.

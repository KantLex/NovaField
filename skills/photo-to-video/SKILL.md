---
name: photo-to-video
description: Bring photos and pictures to life in NovaField - family and archive photos, artwork, product shots, travel pictures, posters - with gentle camera moves, drawn motion paths or a short scene that starts on the picture, and cut a set of them into a slideshow film with music. Use when the person wants to animate a photo, make a picture move, turn photos into a video, a memorial or anniversary film, a living portrait, or a photo montage.
---

# Photo to video

A photo becomes a few seconds of life. Read the `novafield-director` skill first for the ground
rules (plan, show the price, approval, `max_credits`).

**People in photos:** animate real people only with the person's say-so (their own photos, family,
people who agreed). Keep it respectful: no changes to what someone does or says that they wouldn't
have done, and say so if a request crosses that line. For loved ones who have passed, offer the
gentlest options (light, breath, a slow push) and let the person choose.

## 1. Look at each picture and choose the treatment

| The picture | Treatment | Tool and settings |
|---|---|---|
| A portrait, a family photo | Living portrait: breath, a blink, a slight smile, light shifting | `generate` with `start_frame`, `locked` or `push_in` at intensity 0.3, prompt the small motion only |
| A landscape, a street, travel | The camera travels into it | `start_frame` + `drone_approach`, `push_in`, `truck_right`, `crane_up` at 0.5–0.8 |
| Specific things that should move (water, clouds, hair, a flag, cars) | Precise motion, everything else still | `animate_still` with a path per thing and pins on what mustn't move |
| Artwork, a painting, a poster | Parallax: the scene opens up in depth | `animate_still` `frame_move: push_in` (amount 0.1–0.2) plus a few gentle paths, or `start_frame` + `drift` |
| A product photo | A slow hero move | `start_frame` + `orbit_left` or `arc_in` at 0.4, `lighting: "backlit"` |
| An old, small or damaged photo | Restore first | An upscale or restore image workflow (`find_workflows`), then animate the result |

Prompts describe only what moves and how ("she smiles and looks slightly to the left, hair
moving in a light breeze"). Never describe a different scene: the picture is the scene.

Keep the picture's shape: pass `aspect` matching the photo (`9:16` for phone portraits, `4:3`
for old prints, `16:9` for landscapes). `animate_still` keeps the still's shape on its own.

## 2. Production

1. Upload or point at each picture (`file`, or a library asset). For a set, register them as one
   asset so they stay together.
2. Plan every clip (`plan_shot` / `animate_still` with `plan_only`), 3–5 s each, `quality: "draft"`.
   One table: picture, treatment, price; total; approval; `max_credits`.
3. Render; review with the person; redo with a gentler intensity if anything distorts. Faces
   distort first, so lower the intensity rather than adding words.
4. Final clips at `studio` with the same seeds, and `smooth: true` for silkier slow motion if the
   server can interpolate (`status` caps).

## 3. Slideshow film

`set_edit` in order (chronological for a life story), 4–6 s per photo, `dissolve` between them.
`assemble_film` with the person's music: `soundtrack: {file, mix: "replace"}`. Match the length
to the song: photos × seconds per photo ≈ song length, or trim the song's start with
`soundtrack.start`.

Hand over the film, each clip, and which settings made each one, so they can redo a favourite.

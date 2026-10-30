---
name: social-series
description: Plan and produce a batch of short vertical social videos in NovaField - a content series with a recurring format, scroll-stopping hooks, seamless loops, consistent characters or style, and a posting-ready set of clips. Use when the person wants TikTok, Reels or Shorts content, a series of posts, a content calendar's worth of videos, looping videos, or a recurring social format.
---

# Social series

Many short posts with one recognisable format. Read the `novafield-director` skill first for the
ground rules (plan, show the price, approval, `max_credits`).

## 1. The format

Agree on a format that can repeat, so every post is the same show with new content:

- **The premise in one line**: "A tiny chef cooks in a dollhouse kitchen", "Daily city at
  blue hour from impossible angles", "A cat reviews luxury products".
- **The recurring elements**: the same character (a `character` asset), set (`location`), look,
  and camera signature (always `orbit_left`, always `crash_zoom` in, always `overhead`).
- **Length**: 6–15 s. One idea per post.
- **Aspect**: `9:16`. Keep subjects in the middle 60% (platform UI covers the edges and bottom).
- **Count**: how many posts (e.g. 10). Batch them; it's cheaper to plan and review together.

## 2. Hooks (the first second)

Each post opens on its strongest frame. No slow fades in. Patterns that work:

- **Mid-action**: start inside the motion (`snap_push`, `whip_pan`, `fpv_dive`).
- **Impossible camera**: an angle no phone can take (`overhead`, `bullet_time`, `aerial_orbit`).
- **Scale or surprise**: something tiny made huge, or a reveal (`pull_out`, `drone_reveal`).
- **A question**: an odd image that makes people wait for the explanation.

## 3. Loops

A post that loops seamlessly gets rewatched. Two ways:

- **Same first and last frame**: render the post, grab its first frame (`take_frame` with
  `at: 0`), then render the final version with that frame as **both** `start_frame` and
  `end_frame`, and a move that returns where it began (`full_orbit`, `orbit_left` with a
  matching return, `drift`). The end lands on the start.
- **Endless motion**: subjects that cycle (waves, a rotating object, falling snow) with a
  `locked` or `drift` camera, cut so the motion matches at the join.

Trim loops so the last frame isn't repeated: in the edit, end the clip one frame early (`out` a
little under the length).

## 4. Production

1. Write the series sheet: post number, idea, hook, move, prompt, loop or not.
2. Plan every post (`plan_shot`, `aspect: "9:16"`, `quality: "draft"`), show one table with prices
   and the total, and get approval and `max_credits`.
3. Render in batches of 4–8 into one project for the series; `takes: 2` for the hooks.
4. Review together; star the keepers; redo misses with a sharper hook rather than a new seed.
5. Final versions at `studio`, same seeds, `smooth: true` if the server can interpolate (motion
   reads better on phones).

## 5. Deliver posting-ready files

Each post is one film: pass that post's `clips` straight to `assemble_film` (a separate `title` per
post, e.g. `title: "series_ep03"`). With music: `soundtrack: {file, mix: "replace"}`; many people add
trending audio in the app instead, so offer a silent version too (`sound: false` in the renders,
no soundtrack).

Hand over: the list of posts with film URLs, a caption idea and hashtags per post if the person
wants them, and the series sheet for making more.

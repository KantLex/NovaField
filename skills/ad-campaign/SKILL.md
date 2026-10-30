---
name: ad-campaign
description: Turn one ad concept into a full campaign of variants in NovaField - several hooks, angles and offers, cut to 6, 15 and 30 seconds in 16:9, 9:16 and 1:1, named consistently and laid out for comparison and A/B testing. Use when the person wants ad variations, an ad campaign, creatives for testing, platform versions of an ad, or many ads from one shoot.
---

# Ad campaign

One shoot, many ads. A campaign is a matrix: hooks × lengths × aspect ratios. Most of it comes from
re-cutting a shared set of shots; only the hooks and aspect-specific framings need extra renders.
Read the `novafield-director` skill first for the ground rules (plan, show the price, approval,
`max_credits`) and `product-spot` for how to shoot a product.

## 1. The campaign brief

- **Product and the single message** (see `product-spot`).
- **Platforms** → aspects: `9:16` (TikTok, Reels, Shorts, Stories), `1:1` (feeds), `16:9`
  (YouTube, web, TV).
- **Lengths**: 6 s (bumper), 15 s, 30 s.
- **What's tested**: usually the **hook** (the first 2–3 s decides whether people stay), sometimes
  the offer or the call to action at the end.
- **Budget**: how many variants. Show the matrix before planning; it multiplies fast.

## 2. The variant matrix

Agree on 3–5 hooks, each a different reason to watch:

| Hook | Angle | First 2 s on screen |
|---|---|---|
| H1 Problem | The pain the product removes | A coffee spills across a laptop |
| H2 Result | The outcome, shown first | The finished room, then rewind |
| H3 Curiosity | An odd, unexplained image | The bottle floating in a dark pool |
| H4 Social | People using it, energy | Three friends, quick cuts, laughter |
| H5 Detail | Craft, texture, macro | Extreme close-up of the stitching |

Then the matrix, for example 4 hooks × (15 s in 9:16 and 1:1) + (30 s in 16:9) = 12 ads. Name
every ad the same way:

```
<product>_<hook>_<length>_<aspect>_v<n>      e.g. aero_H2_15s_9x16_v1
```

Use that name as the `title` in `assemble_film`, and one project per campaign.

## 3. What to render

- **Shared body shots** (demo, lifestyle, hero, pack shot): render once per aspect. The same prompt
  and seed in each aspect keeps them recognisably the same shot; frame the product centrally for
  `9:16`.
- **Hook shots**: one set per hook per aspect, `takes: 2`. The hook carries the test, so it gets
  the best renders.
- **Product consistency**: cast the product asset in every shot; swap it in with `replace_object`
  where a good shot got the product wrong.

Plan everything first (`plan_shot`), then show one table grouped by hook and aspect with prices,
the total, and the number of ads it yields. Get approval and `max_credits`. Render the hooks first,
review them with the person, and only then the body shots they need.

## 4. Cutting the variants

Each ad = hook (2–3 s) + body (trimmed to length) + pack shot (1.5–2 s, room for the end card):

| Length | Hook | Body | Pack |
|---|---|---|---|
| 6 s | 2 s | 2.5 s (one hero shot) | 1.5 s |
| 15 s | 2–3 s | 10 s (3–4 shots) | 2 s |
| 30 s | 3 s | 25 s (7–9 shots) | 2–3 s |

Build each with `set_edit` (`in`/`out` per clip) in the campaign project. Only one edit is saved
per project at a time, so for each variant set the edit and `assemble_film` it straight away,
or pass `clips` directly to `assemble_film`. Same music bed across variants
(`soundtrack: {file, mix: "replace"}` or `"under"`), so only the picture differs in a test.

## 5. Deliver

- A table of every ad: name, hook, length, aspect, film URL, and its shots (take ids, in/out).
- Which variants share which shots, so a winning hook can be re-cut longer later.
- End cards, logos, claims and legal lines are added in the person's editor; NovaField leaves the
  last 2 s clean for them.
- After the test, offer to make more variants of the winning hook (new body shots or offers) from
  the same shoot.

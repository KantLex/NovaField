---
name: one-take
description: Make a continuous one-take (oner, long take) of 20 to 90 seconds in NovaField by chaining shots that each start on the last frames of the one before, with a planned camera journey and invisible joins. Use when the person wants a long take, oner, single continuous shot, unbroken tracking shot, a walk-through, or a video longer than one 15-second shot without visible cuts.
---

# One take

One shot is at most 15 s. A one-take strings several together with `continue_from`: each new shot
starts on the previous take's last frames, so the cut disappears. Read the `novafield-director`
skill first for the ground rules (plan, show the price, approval, `max_credits`).

## 1. Design the journey

Write it as a route with stations, like a Steadicam operator would:

| Leg | Seconds | Where the camera goes | What happens in frame | Move | Size at the end |
|---|---|---|---|---|---|
| 1 | 0–8 | From the street through the café door | @Mira pushes the door open | `steadicam` | medium |
| 2 | 8–16 | Follow her to the counter | She orders; the barista turns | `truck_right` | close |
| 3 | 16–24 | Drift past her shoulder to the window | Rain starts outside | `arc_in` | wide |

Rules for joins that disappear:
- **Each leg ends on a stable, readable frame**: the camera mid-motion is fine, but the subject
  must be clear, not blurred or half out of frame. That last frame is the next leg's start.
- **Keep motion continuous**: if leg 1 ends moving right, leg 2 starts moving right (same move or
  one that flows from it: `truck_right` → `arc_in`, `steadicam` → `steadicam`).
- **No new characters appear from nowhere at a join**; introduce them inside a leg.
- **One lighting and one look for the whole take**, unless the story moves through doors into
  new light (then change it inside a leg, in words).
- **6–10 s per leg** gives the model room; 3–6 legs make 20–60 s.

## 2. Settings

- MiniMax H3 only (`continue_from` doesn't work with imported engines or previs).
- The same `aspect`, `quality`, `look`, `lighting` and cast on every leg; repeat the character and
  location lines word for word.
- `sound`: on for ambience that runs through, or off if music will carry it.
- Optional `smooth: true` on every leg for 48 fps (all legs or none).

## 3. Production: strictly in order

Legs depend on each other, so they render one after another:

1. Plan leg 1 (`plan_shot`). Plan the rest as estimates (same settings without `continue_from`,
   since it needs a finished take). Show the per-leg and total price; get approval and
   `max_credits` for the whole take.
2. Render leg 1 with `takes: 2`. Wait (`get_take`), pick the better one with the person. Its last
   frame decides everything after it.
3. Render leg 2 with `continue_from` = the chosen leg-1 take. Wait, choose, and continue.
4. If a leg drifts (face, wardrobe, layout), redo **that** leg before going on; everything after
   depends on it. Use `recast` for a face that drifted inside an otherwise good leg.

## 4. Cut

A continued take repeats the previous take's last frames at its start. The app trims that overlap
when a clip starts at its default `in`, so give each leg as a whole take, joined with `cut`:

```
set_edit clips: ["leg1", "leg2", "leg3", …]   (take ids, in order, all cut)
```

Watch the joins in `get_edit` / the editor. If one jumps, trim the end of the earlier leg a little
(`out`) rather than the start of the next. `assemble_film`, with a `soundtrack` if there's music.

Hand over the film, the route table, and the take id of every leg so any leg can be redone and the
rest re-continued from it.

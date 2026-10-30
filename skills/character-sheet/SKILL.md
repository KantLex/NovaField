---
name: character-sheet
description: Create and lock a consistent character in NovaField - design from a description or photos, a turnaround and expression set, test shots, registering the best pictures as a cast asset, and keeping the face across a whole production. Use when the person wants to create a character, cast someone, make a character sheet or turnaround, or fix a face that keeps changing between shots.
---

# Character sheet

A character the models can hold onto: the right pictures in the asset library, one fixed
description, and a test that proves it holds. Read the `novafield-director` skill first for the
ground rules (plan, show the price, approval, `max_credits`).

Real people: only create a character from photos of a real person when the person says they
have the right to (themselves, a consenting actor, their own artist). Never imitate a celebrity
or public figure.

## 1. The character line

Write one description and reuse it word for word in every prompt:

> "@Mira, a woman in her early 30s, slim, sharp cheekbones, short black bob with a blunt fringe,
> small scar through her left eyebrow; wears a rust-orange raincoat over a grey hoodie, black
> jeans, white sneakers."

Include age, build, face, hair, one distinctive mark, and the wardrobe. Name a `@Handle`: the
asset name without spaces.

## 2. Pictures

**From photos the person has**: pick 3–6 clear ones (front-facing, even light, the face
unobstructed, at least one full body). Skip group shots, sunglasses and heavy filters.

**From nothing**: make them with an image workflow. `list_engines` shows imported workflows with
`output: image`; `run_workflow` with `plan_only` first. Generate a set, all with the character
line and the same seed family:

| Picture | Prompt addition |
|---|---|
| Front, neutral | "front view, neutral expression, plain grey studio backdrop, soft even light, full body" |
| Three-quarter | "three-quarter view, …" |
| Profile | "side profile, …" |
| Close portrait | "head and shoulders, front, …" |
| Expressions | "laughing", "angry", "afraid", "tired" (head and shoulders) |

Plan the batch, show the price, get approval, then run it. Pick the most consistent set with the
person. Discard the off-model pictures from the sheet, but never delete files.

## 3. Register

`register_asset` with `kind: "character"`, the name, the character line as `description`, and
the chosen files (local paths, or take URLs from `get_take`). Add more pictures later by passing
the asset `id`.

Wardrobe variants (a suit for the wedding scene) work best as a second asset ("Mira formal")
with its own pictures and wardrobe line, so shots cast exactly one look.

## 4. Prove it: a test reel

Plan four short test shots (`quality: "draft"`, 5 s), casting the asset in each:

1. `close`, `eye`, 85 mm, `push_in` 0.5: the face.
2. `medium`, `low`, 35 mm, `orbit_left`: the face turning (hardest for consistency).
3. `full`, `eye`, 24 mm, `steadicam`: walking, the wardrobe and silhouette.
4. `close`, `high`, 50 mm, `handheld` 0.4: emotion, a different light (`neon` or `golden`).

`takes: 2` each. Review side by side with the asset pictures: face shape, eyes, hair, mark,
wardrobe. If one angle fails, add a picture of that angle to the asset and test again.

## 5. Holding it across a production

- Cast the asset in every shot the character is in, and paste the character line every time.
- **One character per shot is easiest.** For two, cast both assets and name both handles in the
  prompt with clear positions ("@Mira on the left, @Jun on the right").
- **When a shot drifts**: keep the take (the motion and framing may be perfect) and `recast` it
  with the character asset. `notes` keep the wardrobe and lighting ("keep the raincoat, keep
  the neon light").
- **Stand-in workflow** for complex action: shoot with any figure, then `recast` every shot to
  the character.
- Keep the character's pictures and line in the project notes for anyone continuing the work.

---
name: lookbook
description: Build a look book in NovaField - turn reference images, films or a mood into style assets, a chosen film look, lighting and palette, tested on the same shot side by side, then a look bible and shot list for the production. Use when the person has a mood board or references, wants to find the visual style for a project, or asks how something should look.
---

# Look book

Decide how the film looks before shooting it: references in, a tested look out. Read the
`novafield-director` skill first for the ground rules (plan, show the price, approval).

## 1. Gather references

Ask for 5–15 images (stills, photos, paintings) or film titles, and three words for the feeling
("lonely, electric, late"). Register the images as one `style` asset (`register_asset`,
kind `style`) with a description of what they share: palette, contrast, grain, light direction,
lens feel.

## 2. Translate references into NovaField settings

| If the references feel… | look | lighting | lens / moves |
|---|---|---|---|
| Warm, nostalgic, 35 mm cinema | `kodak_2383` | `golden`, `natural` | 35–50, `drift`, `push_in` |
| Soft, quiet, Japanese drama | `fuji_eterna` | `overcast`, `natural` | 35–50, `locked`, `steadicam` |
| Gritty, war, harsh | `bleach_bypass` | `overcast`, `storm` | 24–35, `handheld` |
| Blockbuster, action | `teal_orange` | `backlit`, `golden` | 24, `orbit_left`, `snap_push`, `drone_reveal` |
| Crime, mystery, black and white | `noir` | `rembrandt`, `neon` | 35–50, `creep_in`, `dutch` angle |
| Musical, playful, retro colour | `technicolor` | `natural` | 35, `crane_up`, `full_orbit` |
| Night, cold, blue | `moonlight` | `blue_hour`, `neon` | 50–85, `drift` |
| Home video, 80s–90s | `vhs_1989` | `natural`, `firelight` | 24, `handheld` |
| Clean, modern, commercial | `none` | `natural`, `backlit` | 50–85, `arc_in`, `rack_focus` |

Palette and production design go into the prompt: "muted teal walls, sodium-orange street
lights, wet asphalt".

## 3. Test: same shot, different looks

Pick one representative shot (a character in the main location). Plan three to four variants
that differ **only** in look and lighting, same prompt, move and seed. Show the price, get
approval, and render them as drafts. Put the results side by side with the references and choose
with the person. Then one more round to fine-tune (intensity of the move, lens, palette words).

Extreme styles (animation, painting, claymation) are best done as a pass: shoot plainly, then
`restyle` with the style asset's picture and words (see the `henshin` skill). Test that on the
same reference shot too.

## 4. The look bible

Write it down for the person and for every later shot:

- Film look, lighting per scene type (day, night, interior), aspect.
- Palette words and production-design words to paste into prompts.
- Lens and movement rules ("50 mm and slower moves for intimacy; 24 mm and handheld for chaos").
- What to avoid.
- The style asset id, and the restyle settings if a pass is used.
- The chosen test take ids as references.

Then hand over to the production skill (`script-to-film`, `short-drama`, `music-video`,
`product-spot`) with the bible applied to every shot.

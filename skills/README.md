# NovaField skills

Playbooks that teach an AI agent how to make whole pieces with
NovaField's MCP tools: what to plan, in what order, and how to keep it consistent. Each folder is
one skill (`SKILL.md`). They all follow the same rule: plan for free, show the price, render only
after the person approves, within the `max_credits` they approved.

| Skill | Makes |
|---|---|
| `novafield-director` | The base: ground rules, every tool, the shot vocabulary. The others build on it |
| `script-to-film` | A short film from a script, story or idea |
| `short-drama` | A vertical short-drama series: bible, recurring cast, hook-to-cliffhanger episodes |
| `music-video` | A music video cut on the beat, with the song laid over it |
| `product-spot` | A product commercial in 6, 15 and 30 s cuts and several aspect ratios |
| `trailer` | A trailer, teaser or sizzle, mostly from existing takes |
| `ad-campaign` | One ad concept as many variants: hooks × lengths × aspect ratios, named for A/B tests |
| `social-series` | A batch of vertical posts in one recurring format, with hooks and seamless loops |
| `one-take` | A continuous 20–90 s long take, chained shot to shot with invisible joins |
| `storyboard-animatic` | Keyframe boards with an image model, then an animatic moving between them |
| `photo-to-video` | Photos and artwork brought to life, and a slideshow film with music |
| `character-sheet` | A consistent character: pictures, a fixed description, a test reel |
| `lookbook` | A tested look from references: film stock, lighting, palette, a look bible |
| `henshin` | Recast, restyle, replace objects in, and animate existing footage and stills |
| `comfy-workflows` | Find, import and run any ComfyUI workflow, with a model menu and a recommended default |
| `score-and-voice` | Music and voice-over from audio workflows, laid over the cut |

## Install

Connect the MCP server first (`pnpm novafield setup` prints the command). Then:

Each skill is a folder with a `SKILL.md`, the format agents that support skills read. Link the
folders into your agent's skills folder once, and they stay up to date with this checkout. From
the NovaField folder, with `SKILLS_DIR` set to that folder:

```bash
mkdir -p "$SKILLS_DIR" && for d in "$(pwd)"/skills/*/; do ln -sfn "$d" "$SKILLS_DIR"/; done
```

An agent that takes uploaded skills instead can take a zip of a skill's folder.

Then just ask: "make a 90-second short drama episode about…", "cut a music video for this
song", "make a 15-second ad for this bottle".

## Writing a new skill

Copy a folder, keep the frontmatter (`name`, and a `description` that says when to use it), and
start from the `novafield-director` rules. Name only tools and parameters that exist (`pnpm mcp`
lists them), and say plainly what NovaField can't do for that kind of piece.

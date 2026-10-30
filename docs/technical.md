# NovaField technical guide

**English** · [日本語](technical.ja.md) · [繁體中文](technical.zh-Hant.md)

How NovaField works inside: how it drives ComfyUI, how each feature's graph is built, the node
pack, testing, the agent API and the code layout. For using the app, see the
[README](../README.md).

## Stack

- **App:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, zustand, motion.
  The UI and the API routes live in one Next app on port 4317.
- **Server side:** a ComfyUI client (`src/server/comfy.ts`) with a WebSocket hub that pushes
  progress to the browser, a job runner, a JSON job store in `data/`, and ffmpeg/ffprobe for
  conforming uploads, posters, tails and film assembly.
- **Node pack:** `comfyui-novafield/`, pure Python with torch and numpy only.
- **Tests:** vitest with happy-dom and Testing Library, Playwright for the browser test, pytest for
  the node pack.

## How NovaField uses ComfyUI

### Graphs are compiled, not templated

Engines (`src/lib/engines`) build API-format graphs in TypeScript from a **job spec**, the typed
description of what the person asked for (`src/lib/engines/specs.ts`: `ShotSpec`, `RecastSpec`,
`RestyleSpec`, `ReplaceSpec`, `PathsSpec`, `WorkflowSpec`, `ImageSpec`, `GradeSpec`).
`src/lib/engines/index.ts` dispatches each kind to its compiler and its **blocker**, a function
that returns a readable reason when the server can't run the spec.

Before queueing, every graph is checked against the server's live `/object_info`
(`src/lib/comfy/validate.ts`): node names, input types, link types, enum values (models, LoRAs) and
ranges. A missing model becomes a readable message instead of a failed render.

### Capability-aware UI

`src/lib/engines/capabilities.ts` reads `/object_info` once per connection and derives what the
server can do: which MiniMax H3, Wan, image and interpolation models are present, and which
NovaField nodes (and which of their inputs) exist. For example `caps.pack.filmLooks` is the
server's own list of film stocks and `caps.pack.filmControls` says whether NovaLensFilm has the
0.3.0 colour controls. The UI locks a feature, with what to install, instead of failing at render
time, and sends only the inputs the server's node version knows.

### The previs (ghost rig): camera control without a camera model

The `NovaGhostRig` node renders the chosen camera move as a grey wireframe "carrier" video on the
GPU. That video goes straight into MiniMax H3's reference-video input, with a prompt telling H3 to
copy its camera path and ignore its look. The browser previs and the GPU node share one camera
spec ([contract.md](contract.md)). Fixtures check that the TypeScript and Python versions agree to
6 decimal places, so the move you see is the move that renders.

Without the node pack, the same plan is turned into words, for example: "The camera arcs 74
degrees around the subject… The main subject walks across the frame from left to right."

### Seamless extend

"Continue this shot" cuts the last 22 frames of a take (with sound) and anchors them at frame 0 of
the next render through `MiniMaxH3AddGuide`. Motion and audio carry across the cut. The sequence
assembler drops the repeated frames so the joins are invisible.

### A courteous client for a shared GPU

NovaField never clears the queue or interrupts blindly. It cancels only its own prompts
(`POST /queue {delete}` when pending; a targeted `/interrupt` when running). The header shows when
the GPU is busy with someone else's jobs.

## Feature internals

### Image (`src/lib/engines/image.ts`, `src/ui/image`)

`ImageSpec.tool` is `edit`, `upscale` or `expand`.

- **Edit, Qwen Image Edit:** `UNETLoader` → `ModelAttentionBackend` ("pytorch attention", when
  the node exists) → `ImageScaleToTotalPixels` (1 MP, lanczos, steps of 16) →
  `TextEncodeQwenImageEdit` positive and negative → `ModelSamplingAuraFlow` (shift 3) → `CFGNorm` →
  `KSampler` (20 steps, cfg 2.5) → `VAEDecode` → `SaveImage`.
  The attention override matters: on a server started with `--use-sage-attention`, Qwen Image Edit
  renders solid black without it.
- **Edit, Flux Kontext:** `DualCLIPLoader` (clip_l + t5xxl) → `FluxKontextImageScale` →
  `ReferenceLatent` → `FluxGuidance` 2.5, with a zeroed negative.
- **Expand:** `ImagePadForOutpaint` widens the picture to the chosen aspect (`expandPadding`), then
  the edit graph runs with an instruction to fill the new space (`expandPrompt`).
- **Upscale:** `ImageScale` (lanczos) to the target size, capped near 4.2 MP (`upscaleSize`), then
  a low-denoise Z Image Turbo pass (8 steps, `res_multistep`, denoise `0.15 + 0.4 × creativity`)
  that draws in fine detail. With no prompt it uses the root take's own prompt (`sceneOf`), not an
  edit instruction from a later version.

The Image page's version trail follows `spec.from` back to the root picture (`rootOf`, `versions`).

### Grade (`src/lib/engines/grade.ts`, `src/ui/grade`)

The graph, in order:

```
LoadVideo → GetVideoComponents
  → [FrameInterpolationModelLoader + FrameInterpolate(m) → NovaShutter]   Motion
  → [LoadImage(reference) → NovaMatchColor]                                Match another shot
  → [NovaLensFilm]                                                         Look, colour, lens
  → CreateVideo(fps, audio unless speed ≠ 1) → SaveVideo
```

- Blur comes first, so it averages the source's own colours; the match and the look then apply to
  the final frames.
- `interpolationFor` picks the FILM multiplier from a 6 GB frame budget (2 to 8): big clips get
  fewer in-between frames, but never too few to blur. A closed shutter at normal or higher speed
  only drops frames, so it needs no interpolation.
- `framesAtSpeed` gives the new length; the sound is dropped at any speed other than 1×, with a
  note on the take.
- `meta.engine` lists the pack nodes that ran, for example `NovaShutter + NovaMatchColor + NovaLensFilm`.

**Live preview.** `GradeCanvas.tsx` is a WebGL shader that mirrors NovaLensFilm's maths and the
CIELAB match, so sliders respond instantly. `src/lib/cinema/grade.ts` holds the look parameters;
a parity test parses the Python `LOOK_PARAMS` (via `ast`) and checks both sides agree. **Check
exact** renders the paused frame through the real node (`src/server/gradePreview.ts`,
`/api/grade/preview`); live and exact agree to within 1–2 levels on average.

**Match.** The reference is a frame from the middle of the chosen take (`/api/jobs/[id]/frame`).
The browser measures its Lab statistics (`src/ui/grade/labOf.ts`, `src/lib/cinema/match.ts`) for
the preview; the node measures them again on the GPU.

### Shot QC (`src/server/qc.ts`, `src/lib/qc.ts`, `src/ui/Qc.tsx`)

1. `checkTake` uploads the take's MP4 to ComfyUI as `nf_qc_<id>.mp4` and queues
   `LoadVideo → GetVideoComponents → NovaShotQC`.
2. `NovaShotQC` is an output node: it returns its JSON report as `{"ui": {"text": [report]}}`.
3. The server waits for the prompt (`finished()` in `comfy.ts`), reads
   `history.outputs[node].text`, and stores it on the job as `job.qc`.
4. After every finished take, `checkQuietly` runs the check in the background when the server has
   NovaShotQC. `POST /api/jobs/<id>/qc` runs it on demand.

`needsLook` flags a report with a score under 85 or a high-severity issue. The report format is in
[contract.md](contract.md#novashotqc-040).

## The ComfyUI-NovaField node pack

`comfyui-novafield/` is a custom node pack with no extra Python dependencies (torch and numpy only).
Its own [README](../comfyui-novafield/README.md) documents every input; the shared maths is in
[contract.md](contract.md).

| Node | What it does | Since |
|---|---|---|
| `NovaGhostRig` | Camera path JSON → wireframe motion-guide video (stage, figure, starfield or 2.5D parallax of a photo) | 0.2 |
| `NovaLensFilm` | Film emulation on the GPU: 18 stocks, colour controls, grain, halation, vignette, fringing, gate weave, anamorphic streaks | 0.2 (more stocks and colour controls 0.3) |
| `NovaBoxTrackMask` | Keyframed box or ellipse → feathered mask video, plus the grey-filled control video Wan VACE expects | 0.2 |
| `NovaContactSheet` | Frames → contact sheet image | 0.2 |
| `NovaMatchColor` | Colour continuity: moves a clip's CIELAB statistics onto a reference picture's | 0.4 |
| `NovaShutter` | Shutter motion blur and speed changes from interpolated frames | 0.4 |
| `NovaShotQC` | Frozen frames, jumps, flicker, soft frames and exposure check → JSON report | 0.4 |

The app installs the pack through ComfyUI Manager from the GitHub repo (`src/server/nodes.ts`,
`src/server/packs.ts`). It isn't on the Comfy Registry yet. To release a new version, see
[releasing-nodes.md](releasing-nodes.md).

## Models

The file names the app looks for (`src/lib/engines/capabilities.ts`):

| Feature | Files |
|---|---|
| MiniMax H3 shots | `minimax_h3_fl2va_pruned_int8_convrot`, `minimax_h3_ref2va_pruned_int8_convrot`, Turbo LoRAs `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16` and `minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16`, `qwen3vl_32b_minimax_h3_nvfp4_awq`, `minimax_h3_video_vae_fp16`, `minimax_h3_audio_vae_fp32` |
| Wan (Recast, Restyle, Replace) | `wan2.1_vace_14B_fp16`, `umt5_xxl_fp8_e4m3fn_scaled`, `wan_2.1_vae`, `Wan21_CausVid_14B_T2V_lora_rank32` |
| Wan (Motion paths) | `wan2.1_i2v_480p_14B_fp16`, `clip_vision_h` |
| Qwen Image Edit | `qwen_image_edit_fp8_e4m3fn`, `qwen_2.5_vl_7b_fp8_scaled`, `qwen_image_vae` |
| Flux Kontext | `flux1-dev-kontext_fp8_scaled`, `clip_l`, `t5xxl_fp8_e4m3fn_scaled`, `ae` |
| Upscale | `z_image_turbo_bf16`, `qwen_3_4b`, `ae` |
| 48 fps, Shutter, Speed | `film_net_fp16` |

All are `.safetensors`. Anything missing locks only the feature that needs it.

## Running, testing and checking

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev:dry` sets `NOVAFIELD_DRY_RUN=1`: the app still reads the server's node list and
validates every graph, but renders are simulated locally with placeholder footage, so nothing is
queued on the GPU.

**Connection settings** are saved in `data/connection.json` (keys included, readable only by you)
and replace `COMFY_URL` / `COMFY_API_KEY` from `.env.local`, which still work as the starting point
(see `.env.example`). NovaField won't switch servers while a take is rendering.

Checks:

```bash
pnpm test
```

```bash
pnpm exec tsc --noEmit
```

```bash
pnpm lint
```

```bash
pnpm e2e
```

```bash
cd comfyui-novafield && uv run --python 3.12 --with torch --with numpy --with pytest pytest -q
```

- `pnpm test` runs the app's unit and component tests. They never touch the real `data/` folder.
- `pnpm e2e` starts a fake ComfyUI (`e2e/fake-comfy.ts`) and a dev server on a temporary data
  folder, then makes a take in Studio and checks it lands in the Library.
- The pack tests also write the camera fixtures the TypeScript tests read. Regenerate them with
  `uv run --python 3.12 --with torch --with numpy python tests/make_fixtures.py` in
  `comfyui-novafield`. The fixture check allows floats to differ in their last digits, because
  Linux and macOS maths libraries round slightly differently.

### Translations

The interface is in English plus 10 languages (`src/i18n/locales`). UI strings go through `tr()`,
`toast()` and `say()`; `scripts/i18n-keys.mjs` extracts them.

```bash
node scripts/i18n-add.mjs strings.json
```

```bash
node scripts/i18n-add.mjs --missing
```

The first adds or updates strings in every language at once from a JSON file mapping each
English string to its translations. The second lists what a language lacks.

## Agents: MCP server and CLI

AI agents (any MCP client) can drive the running app through its local
HTTP API. Start the app first (`pnpm dev`), then register the server:

```bash
pnpm novafield setup
```

It prints the server's launch command and the `mcpServers` JSON most MCP clients take, with
absolute paths to Node and this checkout. MCP clients start servers
without your shell's PATH and from another folder, so a bare `pnpm` often isn't found there. Set
`NOVAFIELD_URL` before running it to point the tools at an app on another address (default
`http://localhost:4317`). Inside this folder, `pnpm mcp` also starts the server by hand.

| Tool | What it does |
|---|---|
| `status` | Server, GPU, queue, API key, installed engines |
| `list_engines` | MiniMax H3 plus every imported workflow, tagged local or API (`paid`), with field roles |
| `plan_shot` | Compiles and preflights a shot without rendering: problems, length, size, price. Free |
| `generate` | Renders a shot (`continue_from` carries on from a take's last frames; `smooth` makes it 48 fps). Needs `max_credits` |
| `run_workflow` | Runs an imported workflow by field role (`prompt`, `image`, `seed`…); `plan_only` to preflight. Needs `max_credits` to run |
| `find_workflows` / `import_workflow` | Searches ComfyUI's template library and saved workflows; imports one as an app (and a Studio model) |
| `take_frame` | Saves a frame of a take (the last, or any moment) as a picture for keyframes, thumbnails or stills |
| `get_take` / `list_takes` | A take's status and files (optionally waiting for it); takes filtered by project, status, star, words |
| `cancel_take` | Cancels one of NovaField's own takes; other prompts on a shared server are never touched |
| `list_assets` / `register_asset` | The cast and asset library; add a character with its pictures |
| `list_projects` / `organise_takes` | Move takes into a project (creating it if asked), star them |
| `get_edit` / `set_edit` | The Sequence editor's timeline for a project: clips with in/out and cut or dissolve |
| `assemble_film` | Cuts the edit into one MP4 with ffmpeg on this machine (no GPU, no credits), optionally under a `soundtrack` |
| `recast` | Henshin: swaps the person in a clip for a character, keeping motion and camera |
| `restyle` | Henshin: re-renders a clip in a new look, shot for shot |
| `replace_object` | Henshin: tracks a box over a thing and turns it into something else |
| `animate_still` | Henshin: brings a still to life along drawn paths, with optional camera-like frame moves |

Resources: `novafield://camera/moves` (every move id, framing, lenses, light, film looks, how to
stack moves or write a rig), `novafield://camera/contract` (`docs/contract.md`) and
`novafield://specs` (the job spec types).

**Skills.** `skills/` holds playbooks that teach an agent whole pieces on top of these tools:
`short-drama`, `music-video`, `script-to-film`, `product-spot`, `ad-campaign`, `social-series`,
`trailer`, `one-take`, `storyboard-animatic`, `photo-to-video`, `character-sheet`, `lookbook`,
`henshin`, `comfy-workflows`, `score-and-voice`, and the base `novafield-director`.
`pnpm novafield setup` prints where they are; see
[skills/README.md](../skills/README.md).

**The credit guard.** `generate`, `run_workflow` and the Henshin tools refuse to queue anything
unless the agent passes `max_credits`, and they refuse whenever the preflight price could exceed
it: a range is checked at its top, several takes are added up, and a paid node whose price can't be
bounded (no number, or billed by tokens or seconds) is refused outright. The app checks the ceiling
again before queueing (`POST /api/jobs` with `maxCredits` answers 402). Use `max_credits: 0` for
local GPU work only. Agents are told to show the plan and price and get the person's approval first.

The same client backs the CLI (`src/agent/cli.ts`). It does everything the MCP tools do, plus
Image, Grade and Shot QC. Every command that renders only plans and prints the price until it gets
`--max-credits` (0 = local GPU only), exactly like the tools.

| Group | Commands |
|---|---|
| Server | `status`, `engines [--fields]`, `moves` (the camera vocabulary) |
| Make | `shot`, `recast`, `restyle`, `replace`, `animate`, `image edit\|upscale\|expand`, `grade`, `run <workflow>` |
| Check | `qc <take>`: score, and each fault with its time |
| Library | `takes`, `take`, `cancel`, `frame`, `move`, `star`, `projects`, `assets`, `asset` |
| Workflows | `find-workflows`, `import <file \| template:<name> \| saved:<path>>` |
| Edit | `edit`, `edit set <clip>…`, `film [--soundtrack]`, `setup` |

Pictures and clips are written the same way everywhere: `asset:<id>`, `take:<id>` (with `@<seconds>`
for one frame of it), a file path, or a bare take or asset id. Shared render options: `--project`,
`--wait` (shows live progress), `--save <file|dir>` (downloads the result) and `--json`.

```bash
pnpm --silent novafield shot "a lighthouse keeper climbs the stairs" --move crane_up --lens 35
```

```bash
pnpm --silent novafield shot "a lighthouse keeper climbs the stairs" --move push_in --lens 35 --max-credits 20 --wait
```

```bash
pnpm --silent novafield recast take:a1b2c3d4 --character asset:c0ffee00 --quality studio --max-credits 0 --wait --save out/
```

```bash
pnpm --silent novafield restyle e5f6a7b8 --style "hand-painted anime" --style-picture take:9a8b7c6d --max-credits 0
```

```bash
pnpm --silent novafield replace e5f6a7b8 --box 0.4,0.2,0.2,0.6 --box 0.5,0.2,0.2,0.6@3 --becomes "a golden retriever" --max-credits 0
```

```bash
pnpm --silent novafield animate take:e5f6a7b8@1 --path "0.45,0.5 0.6,0.5@0.1-0.9:smooth" --frame-move push_in:0.15 --max-credits 0
```

```bash
pnpm --silent novafield image edit asset:c0ffee00 "add a wide straw sun hat" --max-credits 0 --wait
```

```bash
pnpm --silent novafield grade 1f2e3d4c --look cinestill_800t --shutter 180 --speed 0.5 --match 5b6c7d8e --max-credits 0
```

```bash
pnpm --silent novafield run 4b5c6d7e --role prompt="a fox at dusk" --file image=./fox.png --max-credits 0
```

```bash
pnpm --silent novafield qc 1f2e3d4c
```

```bash
pnpm --silent novafield edit set e5f6a7b8:0.5-6 1f2e3d4c:0-8:dissolve --project "Night Market"
```

```bash
pnpm --silent novafield film --project "Night Market" --title "Cut 1" --soundtrack ./score.mp3 --mix under --save out/
```

Boxes are `x,y,w,h` fractions of the frame (`@seconds` for a moving thing), paths are `"x,y x,y"`
with an optional `@start-end` and `:ease`, edit clips are `<take>[:in-out][:cut|dissolve]` (a
trailing `!` mutes one). `pnpm novafield --help` lists every option.

## Data

Everything NovaField keeps is in `data/` (not in git), or in the folder chosen under Settings →
Storage:

| Path | What |
|---|---|
| `jobs.json` | Every take: its spec, status, files, QC report |
| `projects.json`, `sequences.json` | Projects, and one edit per project (`GET`/`PUT /api/sequences/<project id or "all">`) |
| `assets.json`, `assets/` | The asset library and its files |
| `media/`, `films/`, `uploads/` | Renders, assembled films, uploads |
| `workflows/` | Imported workflows and their forms |
| `connection.json` | The server and API keys |
| `storage.json` | Where the media folders live |

The editor and agents share `sequences.json`, so an open editor updates live.

## Layout

```
src/lib/comfy        graph builder, preflight validator, pricing and the credit budget
src/lib/cinema       camera math (shared contract), moves, film looks, grade and match maths
src/lib/engines      spec → graph compilers (H3, Wan, image, grade), capabilities, sizing, prompts
src/lib/workflows    importing ComfyUI workflows and building their forms
src/lib/qc.ts        Shot QC report types and labels
src/server           ComfyUI client, WebSocket hub, job runner, job store, QC, storage, ffmpeg helpers
src/app              pages and API routes
src/ui               monitor, previs, Studio panels, Image, Grade, Henshin editors, graph editor, takes
src/i18n             translations
src/agent            HTTP client, MCP server and CLI for agents
comfyui-novafield    the custom node pack
e2e                  the Playwright test and a fake ComfyUI
scripts              translation tools, node pack release
skills               agent playbooks
samples              a demo previs clip, its camera path and a Blender exporter
docs                 this guide, the app ⇄ node pack contract, releasing the pack
```

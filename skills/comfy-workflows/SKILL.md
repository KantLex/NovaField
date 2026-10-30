---
name: comfy-workflows
description: Find, import and run any ComfyUI workflow through NovaField - browse ComfyUI's template library and the person's saved workflows, offer a clear menu of models with a recommended default, import the chosen one as an app with a form, check missing nodes and paid API nodes, and run it by role (prompt, image, video, seed). Use when the person wants a specific model or ComfyUI workflow, image generation, upscaling, frame interpolation, image editing, audio or 3D through ComfyUI, or asks which models are available.
---

# ComfyUI workflows

NovaField turns any ComfyUI workflow into an app with a form, and can use image and video ones as
Studio models. Read the `novafield-director` skill first for the ground rules (plan, show the
price, approval, `max_credits`).

## 1. What's already here

`list_engines` lists MiniMax H3 and every imported workflow with what it makes, whether it runs
locally or on paid API nodes, and its field roles. Use what's there before importing more.

## 2. Finding one: offer a menu, then wait

When the person wants something not yet imported, `find_workflows` with a `query` and `media`
(`image`, `video`, `audio`, `3d`). Then show **a short menu**: at most five options, numbered,
each with:

- its title in plain words (not the template file name),
- what it's good at in one line,
- **local GPU** or **paid API (credits)**,
- and a recommended default marked as such.

For example:

> 1. **Flux Dev**: detailed, photoreal stills. Local GPU. ← recommended
> 2. **SDXL Turbo**: very fast drafts. Local GPU.
> 3. **GPT Image**: follows complex instructions. Paid API.

Wait for the person's pick. Don't choose for them unless they say "you pick". In that case,
pick the local option that fits best and say why.

## 3. Importing

`import_workflow` with `template`, `saved` (a workflow saved in ComfyUI), or `file` (a `.json` the
person has). The reply tells you:

- **makes**: image, video or audio;
- **fields**: the form, each with its role and current value;
- **engine**: whether it can be a Studio model (it has a prompt and makes images or video);
- **missing**: node packs the server lacks. Tell the person; they install them from the Workflows
  page in the app (or ComfyUI Manager), then import again;
- **paidNodes**: API nodes that bill their Comfy account. Say so before any run.

## 4. Running it

`run_workflow` by role:

```
run_workflow {
  workflow: "<id>",
  roles: { prompt: "…", seed: 42 },
  files: { image: ["/abs/path/input.png"] },     // local files for image, video or audio inputs
  plan_only: true                                  // first: problems and price
}
```

Then show the plan and price, get approval, and run it again without `plan_only` and with
`max_credits`. Fields without a role can be set by id with `fields: {"<node>.<input>": value}`
(ids come from `list_engines` with `fields: true`).

Image and video workflows that are engines also work inside shots: `plan_shot` / `generate` with
`engine: "<id>"`. NovaField then writes the prompt, size, length, seed and first frame into the
workflow for you, so camera direction and cast work as with MiniMax H3.

## 5. Common jobs

| Job | What to look for | How to use it |
|---|---|---|
| Stills, keyframes, character pictures | An image model (Flux, SDXL, Qwen-Image…) | `run_workflow` with the `prompt` role; keep the seed for consistency |
| Image editing, restoring old photos | Image-edit or restore templates | `files: {image: […]}` + a prompt saying what to change |
| Upscaling video or images | Upscale templates | `files` takes local paths: save the take's URL (from `get_take`) to a local file first, then pass that path; for a still from a video take, `take_frame` gives its URL |
| Smoother motion | Frame interpolation | Usually easier: `smooth: true` on shots |
| Music and voice | Audio templates (see `score-and-voice`) | The output is an audio take |

Report every run: the model, the settings that affect price, what it cost, and where the output
is.

# NovaField contract: app ⇄ ComfyUI-NovaField node pack

The app (TypeScript) and the node pack (Python) must agree on everything in this file.
Both implement the camera math below. The fixtures in
`comfyui-novafield/tests/fixtures/camera_cases.json` are the shared truth: the Python tests write
them, the TypeScript tests read them.

## 1. Camera path JSON (`camera_path`)

```json
{
  "version": 1,
  "frames": 124,
  "fps": 24,
  "ease": "inOutCubic",
  "keys": [
    { "t": 0.0, "pos": [0, 1.5, 4.0], "target": [0, 1.4, 0], "fov": 40, "roll": 0 },
    { "t": 1.0, "pos": [0, 1.5, 2.2], "target": [0, 1.4, 0], "fov": 40, "roll": 0 }
  ],
  "shake": { "amount": 0.0, "freq": 1.2, "seed": 7 }
}
```

- World: right-handed, **Y up**, metres. The subject stands at the origin, about 1.75 m tall.
- `keys` sorted by `t` in [0, 1]; at least 1 key. `fov` is the **vertical** FOV in degrees, `roll` in degrees.
- `ease` ∈ `linear | inOutSine | inOutCubic | outExpo | inExpo`. It is applied to the global time
  before key lookup.
- `shake` is optional (missing = no shake).
- `actors` and `follow` are optional (§1b), and so are `props` (§1c). Paths without them behave exactly as before.

### Pose at frame `i`

1. `t_lin = i / (frames - 1)` (if `frames == 1`, `t_lin = 0`).
2. `t = ease(t_lin)`:
   - `linear`: `t`
   - `inOutSine`: `-(cos(π t) - 1) / 2`
   - `inOutCubic`: `t < .5 ? 4t³ : 1 - (-2t + 2)³ / 2`
   - `outExpo`: `t == 1 ? 1 : 1 - 2^(-10t)`
   - `inExpo`: `t == 0 ? 0 : 2^(10t - 10)`
3. Segment lookup: with keys `k_0..k_n-1`. If `t <= k_0.t` use `k_0`; if `t >= k_last.t` use `k_last`.
   Otherwise find `j` with `k_j.t <= t < k_{j+1}.t`, `u = (t - k_j.t) / (k_{j+1}.t - k_j.t)`.
4. `pos` and `target`: uniform **Catmull-Rom** through `p0 = k_{j-1}` (clamped to `k_j` when j = 0),
   `p1 = k_j`, `p2 = k_{j+1}`, `p3 = k_{j+2}` (clamped to `k_{j+1}`):
   `0.5 * (2p1 + (-p0 + p2)u + (2p0 - 5p1 + 4p2 - p3)u² + (-p0 + 3p1 - 3p2 + p3)u³)`
5. `fov`, `roll`: linear between `k_j` and `k_{j+1}` with `u`.
6. Shake (when `amount > 0`): `s = i / fps` seconds, `f = freq`, `ph = seed * 0.7311`:
   - `yaw   = amount * 1.6 * (0.6 sin(2π f s + 1.3 + ph) + 0.3 sin(2π 2.3f s + 0.7 + ph) + 0.1 sin(2π 5.1f s + 2.1 + ph))` degrees
   - `pitch = amount * 1.1 * (0.6 sin(2π 0.9f s + 0.4 + ph) + 0.3 sin(2π 2.7f s + 1.9 + ph) + 0.1 sin(2π 4.3f s + 0.2 + ph))` degrees
   - Rotate the vector `target - pos` by `yaw` about world Y, then by `pitch` about the camera's right
     axis (step 7, before roll); `target = pos + rotated vector`.

## 1b. Stand-ins and follow (optional fields)

```json
{
  "actors": [
    { "from": [0, 0], "to": [2.5, -1.0], "height": 1.75 },
    { "from": [-1.5, 0.5], "to": [-1.5, 0.5], "height": 1.2 }
  ],
  "follow": { "actor": 0, "height": 1.4, "amount": 1.0 }
}
```

- `actors`: up to 3 stand-in people, standing on the floor. `from` and `to` are floor positions
  `[x, z]` in metres; `height` is their height in metres (default 1.75).
- Optional `start` and `end` (each clamped to 0–1, defaults 0 and 1) say when the walk happens, as
  fractions of the shot. Walk progress `u = clamp((t_lin - start) / (end - start), 0, 1)`; when
  `end <= start`, `u = t_lin >= start ? 1 : 0` (the stand-in steps across at `start`).
- Actor position at frame `i`: `w = inOutSine(u)` (always inOutSine, whatever the camera `ease`),
  `p = from + (to - from) * w`, world point `[p.x, 0, p.z]`. With the default timing `u = t_lin`.
- `follow` (camera tracks a stand-in). Applied **after step 5 and before step 6 (shake)**:
  `aim = [p.x, height, p.z]` for actor `follow.actor` at frame `i` (`height` default 1.4),
  `target = target + (aim - target) * amount` (`amount` default 1, clamp 0–1). Ignored when that
  actor does not exist.



## 1c. Set pieces (optional field)

```json
{ "props": [{ "at": [0, -1.5], "size": [1.6, 0.75, 0.9], "rot": 30, "label": "Table" }] }
```

- Up to 8 boxes standing on the floor; extra entries are ignored. `at` is the centre `[x, z]`,
  `size` is `[width, height, depth]` in metres (default `[1, 1, 1]`, each at least 0.05), `rot` is
  degrees about Y (default 0). `label` is for people and is ignored by the node.
- Corners, index `yi*4 + sxi*2 + szi` with `y ∈ {0, height}`, `sx, sz ∈ {-1, 1}`:
  `lx = sx * width / 2`, `lz = sz * depth / 2`,
  `x = cx + lx cos(rot) + lz sin(rot)`, `z = cz - lx sin(rot) + lz cos(rot)`.
- They don't affect the camera. The `stage` and `subject` styles draw their 12 edges (§2).

## Pose, continued

7. `f = normalize(target - pos)`, `r = normalize(cross(f, [0,1,0]))` (if degenerate, use `[1,0,0]`),
   `u = cross(r, f)`.
8. Roll: rotate `r` and `u` about `f` by `roll` degrees: `r' = r cosθ + u sinθ`, `u' = u cosθ - r sinθ`.
9. A world point `P` → camera space: `xc = dot(P - pos, r')`, `yc = dot(P - pos, u')`, `zc = dot(P - pos, f)`.
   Visible when `zc > 0.05`.
10. `focal = (H / 2) / tan(fov / 2)`; `px = W/2 + focal * xc / zc`; `py = H/2 - focal * yc / zc`
    (pixel origin top-left, y down).

## 2. Ghost-rig scene (`style`)

All styles share this geometry so the app's 3D preview matches the render exactly.

- **Floor grid** (`stage`, `subject`): lines on `y = 0` for x and z in [-12, 12], every 1 m.
  The lines at x = 0 and z = 0 are brighter.
- **Pillars** (`stage`, `subject`): wireframe boxes 0.8 × 3.0 × 0.8 (base on the floor), centred at
  `(-4, -6) (4, -6) (-7, 0) (7, 0) (-4, 6) (4, 6)` (x, z).
- **Subject** (`subject` only): capsule at the origin, radius 0.32, base y = 0, top y = 1.75, drawn as
  rings every 0.15 m plus 8 vertical meridians. Warm colour (#FFB46B).
  When the path has an `actors` list, `subject` draws one capsule per actor instead, at that actor's
  position for the frame, scaled by `height / 1.75` (radius and ring spacing scale too). Colours by
  index: #FFB46B, #7FC8F8, #B7E37D. An empty `actors` list means no figures. Other styles ignore actors.
- **Starfield** (`starfield`): 2400 points, uniform in a sphere shell of radius 8–30 around the origin,
  generated by a deterministic LCG: `state = (state * 1664525 + 1013904223) mod 2^32`, seed 1234;
  each point takes 3 draws `a, b, c` → `/2^32`; `theta = 2π a`, `phi = acos(2b - 1)`, `r = 8 + 22c`.
- **Parallax** (`parallax`): the optional input image is treated as a photo taken by the camera at
  frame 0. Each pixel is lifted to 3D with depth (input depth map: white = near; when missing, a vertical
  ramp, bottom near and top far): `z = 1.5 + (1 - d) * 10.5` metres along that pixel's ray. Every
  frame re-projects the points with forward splatting and a z-buffer, then fills the holes.
- **Set pieces** (`stage`, `subject`): the 12 edges of each `props` box (§1c), colour `#C8C0AA`.
- Background `#0B0C10`. Grid lines `#3A4152` (axes `#6B7690`), pillars `#8A93A6`, all with depth fade.

## 3. Nodes

Category `NovaField`. Class names are fixed (the app compiles graphs against them).

### `NovaGhostRig`
Renders a camera-motion carrier video from a camera path.
- in: `camera_path` STRING (multiline), `width` INT (step 8), `height` INT (step 8),
  `style` COMBO [`stage`, `subject`, `starfield`, `parallax`], `line_strength` FLOAT 0.2–3 (default 1)
- optional in: `image` IMAGE, `depth` IMAGE
- out: `frames` IMAGE [F, H, W, 3], `frame_count` INT

### `NovaLensFilm`
Film emulation and lens character on a frame batch, run on the GPU in chunks.
- in: `images` IMAGE, `look` COMBO [`none`, `kodak_2383`, `fuji_eterna`, `bleach_bypass`, `teal_orange`,
  `noir`, `technicolor`, `moonlight`, `vhs_1989`, and since 0.3.0 `kodak_portra_400`, `kodak_vision3_500t`,
  `ektachrome_e100`, `cinestill_800t`, `fuji_velvia_50`, `kodachrome_64`, `ilford_hp5`, `instant_film`,
  `super8`], `intensity` FLOAT 0–1 (default 0.8),
  `grain` FLOAT 0–1, `halation` FLOAT 0–1, `vignette` FLOAT 0–1, `chromatic` FLOAT 0–1,
  `gate_weave` FLOAT 0–1, `anamorphic_streak` FLOAT 0–1, `seed` INT
- optional (0.3.0, neutral defaults, applied after the look): `exposure` FLOAT −2–2 (stops),
  `contrast`, `saturation`, `temperature`, `tint` FLOAT −1–1, `fade` FLOAT 0–1, `grain_size` FLOAT 0.5–3
  (default 1). The app reads the look list and these inputs from `/object_info` and only sends what the
  server's node knows; the browser preview (`src/lib/cinema/grade.ts`, `src/ui/grade/GradeCanvas.tsx`)
  mirrors the same maths.
- out: `images` IMAGE (same shape)

### `NovaBoxTrackMask`
A keyframed box or ellipse track turned into a feathered mask video (no segmentation model needed).
- in: `track` STRING JSON
  `{"shape":"ellipse","keys":[{"f":0,"x":0.4,"y":0.3,"w":0.2,"h":0.4}, ...]}`
  (x, y = top-left corner, all normalised to 0–1; `f` = frame index), `width` INT, `height` INT,
  `frames` INT, `feather` FLOAT 0–0.5 (default 0.08, fraction of box size), `expand` FLOAT 0–0.5 (default 0.05)
- optional in: `images` IMAGE (the source clip)
- out: `mask` MASK [F, H, W], `masked_images` IMAGE (source with the mask area filled with 0.5 grey,
  which is the format Wan VACE wants for `control_video`; when `images` is missing, the mask as RGB)
- Interpolation between keys: smoothstep of the local `u`; frames before the first key / after the last
  key hold that key.

### `NovaContactSheet`
- in: `images` IMAGE, `columns` INT (default 4), `count` INT (default 8), `cell_width` INT (default 320)
- out: `sheet` IMAGE [1, h, w, 3] (frames sampled evenly)

### `NovaMatchColor` (0.4.0)
Colour continuity: gives a clip the colour (and optionally the brightness) of a reference picture.
- in: `images` IMAGE (the clip), `reference` IMAGE (one or more frames of the shot to match),
  `amount` FLOAT 0–1 (default 1), `colour_only` BOOLEAN (default false)
- out: `images` IMAGE (same shape)
- Maths (the browser preview in `src/lib/cinema/match.ts` and `GradeCanvas.tsx` uses the same):
  1. sRGB (clamped 0–1) → linear → XYZ (sRGB matrix, D65 white `0.95047, 1, 1.08883`) → CIELAB
     with `δ = 6/29`.
  2. Mean `μ` and standard deviation `σ` of L\*, a\*, b\* over the **whole clip** and over the
     reference, from an even sample of at most 400 000 pixels each. `σ` is at least 0.001.
  3. `scale = clamp(σ_ref / σ_clip, 0.5, 2)` per channel. With `colour_only`, L\* keeps the clip's
     own mean and spread (`scale_L = 1`, `μ_ref,L = μ_clip,L`).
  4. Every pixel: `lab' = (lab - μ_clip) * scale + μ_ref`, back to sRGB (clamped), then
     `out = x + (srgb(lab') - x) * amount`.
- One correction for the whole clip, so nothing flickers. `amount` 0 returns the input unchanged.

### `NovaShutter` (0.4.0)
Shutter motion blur and speed changes. Feed it frames interpolated `multiplier` times
(`FrameInterpolate` before it).
- in: `images` IMAGE (S sub-frames), `multiplier` INT 1–16 (default 4, the interpolation multiplier
  used before this node), `shutter_angle` FLOAT 0–360 (default 180), `speed` FLOAT 0.1–4 (default 1)
- out: `images` IMAGE at the clip's own frame rate, `frame_count` INT
- Maths:
  - Source frames `n = (S - 1) // m + 1`. Output frames `F = floor((n - 1) / speed) + 1`.
  - Exposure half-width in source frames: `h = (shutter_angle / 360) * speed / 2`. It scales with the
    speed, as a real camera's would, so slow motion stays crisp.
  - Output frame `i` sits at source time `t = i * speed`. It is the mean of sub-frames
    `ceil((t - h) m)` … `floor((t + h) m)`, clamped to the batch. When that window is empty (a
    closed shutter), it is the nearest sub-frame, `floor(t m + 0.5)` (halves round up).
- The app picks `m` (`interpolationFor`): up to 8, at least 2, and fewer for big clips so the
  interpolated batch stays near 6 GB. At speed ≠ 1 the app leaves the sound out.

### `NovaShotQC` (0.4.0)
A health check for a clip, without any model. An output node.
- in: `images` IMAGE, `fps` FLOAT (default 24)
- out: `report` STRING (JSON). It is also returned as `{"ui": {"text": [report]}}`, so the app
  reads it from `/history/<prompt id>` → `outputs[<node id>].text[0]`.
- Report:

  ```json
  {
    "version": 1,
    "frames": 124,
    "fps": 24,
    "score": 86,
    "issues": [{ "kind": "jump", "start": 61, "end": 62, "severity": "medium" }],
    "curves": { "brightness": [0.31], "motion": [0.012], "sharpness": [1.0] }
  }
  ```

  - `kind` ∈ `frozen | jump | flicker | soft | blown | crushed`; `severity` ∈ `low | medium | high`;
    `start` and `end` are frame indices. `blown` and `crushed` span the whole clip and add `amount`
    (the fraction of pixels).
  - `score` is 0–100, starting at 100. At most 60 issues, sorted by `start`.
  - `curves` are sampled to at most 120 points: mean luma per frame, mean absolute luma change
    between frames, and sharpness relative to the clip's median.
- Measures (luma, frames shrunk to 160 px wide for motion and 480 px for sharpness):
  - **frozen:** only when the median frame difference is above 0.004; runs of differences under
    0.0012. High when 3 or more steps. −4 per frame, at most −30.
  - **jump:** a difference above `max(0.06, 5 × median)`. High above twice that. −10 each.
  - **flicker:** a frame brighter or darker than **both** neighbours by more than 0.6 × `pop`, and
    off their average by more than `pop = max(0.015, 4 × median)`. −4 per run.
  - **soft:** runs of 2 or more frames whose Laplacian variance is under 0.45 × the clip's median.
    A single soft frame is ignored. −1.5 per frame, at most −20.
  - **blown:** more than 5% of pixels above 0.985 on average. −10.
  - **crushed:** more than 35% of pixels below 0.015 on average. −3.
- The app flags a take for a second look when `score < 85` or any issue is `high`.

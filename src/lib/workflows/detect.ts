// Read a workflow the way a person would: which values are the prompt, the pictures, the seed,
// the size, the length, the switches. Everything else stays where the author left it.

import { type ApiGraph, type InputValue, isLink } from "../comfy/graph";
import { enumOptions, inputType, isOutputNode, prune, type InputSpec, type ObjectInfo } from "../comfy/validate";
import type { Field, OutputKind, Role } from "./types";

const MEDIA: Record<string, { input: string; kind: "image" | "video" | "audio" }[]> = {
  LoadImage: [{ input: "image", kind: "image" }],
  LoadImageMask: [{ input: "image", kind: "image" }],
  LoadVideo: [{ input: "file", kind: "video" }],
  VHS_LoadVideo: [{ input: "video", kind: "video" }],
  VHS_LoadVideoPath: [{ input: "video", kind: "video" }],
  LoadAudio: [{ input: "audio", kind: "audio" }],
  VHS_LoadAudioUpload: [{ input: "audio", kind: "audio" }],
};
const EXT: Record<"image" | "video" | "audio", RegExp> = {
  image: /\.(png|jpe?g|webp|bmp|tiff?|gif|exr)$/i,
  video: /\.(mp4|mov|webm|mkv|avi|m4v|gif)$/i,
  audio: /\.(wav|mp3|flac|ogg|opus|m4a|aac)$/i,
};

/**
 * Is this input a picture, clip or sound to upload? Known loaders first; then any input with
 * ComfyUI's upload widget; then a loader-ish node whose choices are media files (custom packs).
 */
function mediaKind(classType: string, input: string, spec: InputSpec, options: string[] | null): "image" | "video" | "audio" | null {
  const known = MEDIA[classType]?.find((m) => m.input === input);
  if (known) return known.kind;
  const o = spec[1] ?? {};
  if (o.video_upload) return "video";
  if (o.audio_upload) return "audio";
  if (o.image_upload) return "image";
  if (!options || !/load|upload|input/i.test(classType)) return null;
  if (options.length) {
    const files = options.filter((x) => EXT.image.test(x) || EXT.video.test(x) || EXT.audio.test(x));
    if (files.length < Math.max(1, options.length * 0.6)) return null;
    const count = (k: keyof typeof EXT) => files.filter((f) => EXT[k].test(f)).length;
    const best = (["video", "audio", "image"] as const).reduce((a, b) => (count(b) > count(a) ? b : a));
    return count(best) ? best : null;
  }
  // An empty input folder gives no options to judge by: go by the names.
  if (/^(image|img|picture)$/i.test(input)) return "image";
  if (/^(video|file)$/i.test(input) && /video/i.test(classType)) return "video";
  if (/^audio$/i.test(input)) return "audio";
  return null;
}

const FRAME_NAMES = new Set(["length", "num_frames", "frames", "video_length", "frame_count", "frame_length"]);
const ADVANCED_NUMBERS = new Set(["steps", "cfg", "denoise", "shift", "guidance", "strength", "strength_model", "megapixels", "scale_by"]);
const ADVANCED_CHOICES = new Set(["sampler_name", "scheduler"]);
const SKIP = new Set(["filename_prefix", "format", "codec", "device", "batch_size", "weight_dtype", "pix_fmt", "crf", "save_output", "pingpong", "loop_count", "save_metadata", "trim_to_audio", "upscale_method", "crop"]);
const PRIMITIVES = new Set(["PrimitiveInt", "PrimitiveFloat", "PrimitiveBoolean", "PrimitiveString", "PrimitiveStringMultiline", "INTConstant", "FloatConstant", "easy int", "easy float", "Int Literal", "Float Literal", "String Literal"]);
const SEED_NODES = new Set(["SeedNode", "Seed (rgthree)", "easy seed"]);

const CODE_INPUTS = new Set(["expression", "code", "script", "python_code", "js", "formula"]);

/**
 * "Boolean (Enable Lightning LoRA)" → "Enable Lightning LoRA". The canvas prefixes titles with the
 * node's own name; that part is noise.
 */
const cleanTitle = (t: string, ...names: (string | undefined)[]) => {
  const m = /^(.+?)\s*\((.+)\)$/.exec(t.trim());
  const generic = /^(Float|Int|Integer|Boolean|String|Number|Text|Primitive\w*)$/i;
  const inner = m && (generic.test(m[1]) || names.some((n) => n && n.toLowerCase() === m[1].toLowerCase())) ? m[2] : t.trim();
  return inner.charAt(0).toUpperCase() + inner.slice(1);
};

const pretty = (s: string) =>
  s
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/** Who consumes a node's outputs: [consumer node id, input name], following up to `hops` links. */
function consumers(graph: ApiGraph, id: string, hops = 3): { node: string; input: string; classType: string }[] {
  const out: { node: string; input: string; classType: string }[] = [];
  let frontier = [id];
  const seen = new Set(frontier);
  for (let h = 0; h < hops && frontier.length; h++) {
    const next: string[] = [];
    for (const [nid, n] of Object.entries(graph)) {
      for (const [input, v] of Object.entries(n.inputs)) {
        if (isLink(v) && frontier.includes(v[0])) {
          out.push({ node: nid, input, classType: n.class_type });
          if (!seen.has(nid)) {
            seen.add(nid);
            next.push(nid);
          }
        }
      }
    }
    frontier = next;
  }
  return out;
}

export function detectOutput(graph: ApiGraph, info: ObjectInfo): OutputKind {
  const outs = Object.values(graph).filter((n) => isOutputNode(n.class_type, info)).map((n) => n.class_type);
  if (outs.some((c) => /video|webm|webp|gif|combine|mp4/i.test(c))) return "video";
  if (outs.some((c) => /image/i.test(c))) return "image";
  if (outs.some((c) => /audio|flac|mp3|wav/i.test(c))) return "audio";
  return "unknown";
}

export function detectFps(graph: ApiGraph): number | null {
  for (const n of Object.values(graph)) {
    for (const k of ["fps", "frame_rate"]) {
      const v = n.inputs[k];
      if (typeof v === "number" && v > 0 && v <= 120) return v;
    }
  }
  return null;
}

export function detectFields(full: ApiGraph, info: ObjectInfo, titles: Record<string, string> = {}): Field[] {
  const graph = prune(full, info);
  const fields: Field[] = [];
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  let sizeTaken = false;

  // Stable order: by node id (numeric where possible), as the author laid them out.
  const ids = Object.keys(graph).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const id of ids) {
    const node = graph[id];
    const def = info[node.class_type];
    if (!def) continue;
    const rawTitle = titles[id] ?? node._meta?.title;
    const title = rawTitle ? cleanTitle(rawTitle, def.display_name, node.class_type) : undefined;
    const group = title && title !== def.display_name ? title : (def.display_name ?? node.class_type);
    const named = !!rawTitle && rawTitle !== def.display_name && rawTitle !== node.class_type;
    // "model.aspect_ratio" is a setting of the model chosen in "model" (a dynamic choice), so its
    // spec sits under that option rather than on the node itself.
    const specOf = (name: string): InputSpec | undefined => {
      const dot = name.indexOf(".");
      if (dot < 0) return def.input.required?.[name] ?? def.input.optional?.[name];
      const parent = def.input.required?.[name.slice(0, dot)] ?? def.input.optional?.[name.slice(0, dot)];
      const options = (parent?.[1]?.options ?? []) as { key?: string; inputs?: { required?: Record<string, InputSpec>; optional?: Record<string, InputSpec> } }[];
      const chosen = options.find((o) => o && typeof o === "object" && o.key === node.inputs[name.slice(0, dot)]);
      const rest = name.slice(dot + 1);
      return rest.includes(".") ? undefined : (chosen?.inputs?.required?.[rest] ?? chosen?.inputs?.optional?.[rest]);
    };
    const hasW = typeof node.inputs.width === "number" && typeof node.inputs.height === "number";

    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLink(value) || value === null) continue;
      const spec = specOf(key);
      if (!spec) continue;
      // Name checks below use the setting's own name ("aspect_ratio" in "model.aspect_ratio").
      const input = key.slice(key.lastIndexOf(".") + 1);
      const t = inputType(spec);
      const opts = spec[1] ?? {};
      const base = { id: `${id}.${key}`, node: id, input: key, group, value: value as InputValue };
      const push = (f: Omit<Field, keyof typeof base>) => fields.push({ ...base, ...f });

      // Pictures, clips, sound.
      const media = typeof value === "string" ? mediaKind(node.class_type, input, spec, enumOptions(spec)) : null;
      if (media) {
        const n = count(media);
        const label = named ? title! : `${pretty(media)}${n > 1 ? ` ${n}` : ""}`;
        push({ kind: media, role: media, label, exposed: true, advanced: false });
        continue;
      }

      // Seeds.
      const seedLike = (t === "INT" && (opts.control_after_generate === true || ["seed", "noise_seed"].includes(input))) || SEED_NODES.has(node.class_type);
      if (seedLike && typeof value === "number") {
        push({ kind: "seed", role: "seed", label: count("seed") > 1 ? `Seed ${counts.seed}` : "Seed", min: 0, max: Math.min(Number(opts.max ?? 2 ** 53), 2 ** 53 - 1), integer: true, exposed: true, advanced: true, randomize: true });
        continue;
      }

      // Prompts: multiline text. Negative when it feeds a sampler's negative input.
      if (CODE_INPUTS.has(input) || /MathExpression|Eval|Python/i.test(node.class_type)) continue;
      if (t === "STRING" && (opts.multiline || node.class_type === "PrimitiveStringMultiline")) {
        // The input's own name decides first: some encoders take positive_prompt and
        // negative_prompt on one node, so the wiring alone can't tell them apart.
        const byName = /neg/i.test(input) ? "negative" : /pos/i.test(input) ? "prompt" : null;
        const downstream = consumers(graph, id, 4);
        const negative = byName
          ? byName === "negative"
          : /neg/i.test(title ?? "") || (downstream.some((c) => c.input === "negative") && !downstream.some((c) => c.input === "positive" || c.input === "conditioning"));
        const role: Role = negative ? "negative" : "prompt";
        const n = count(role);
        push({
          kind: "text",
          role,
          label: byName
            ? pretty(input)
            : named
            ? title!
            : negative
              ? "Negative prompt"
              : !["text", "prompt", "value", "string"].includes(input)
                ? pretty(input)
                : n > 1
                  ? `Prompt ${n}`
                  : "Prompt",
          multiline: true,
          exposed: true,
          advanced: negative,
        });
        continue;
      }

      if (SKIP.has(input)) continue;

      // Switches the author left as primitives.
      if (t === "BOOLEAN") {
        const target = consumers(graph, id, 1)[0];
        push({
          kind: "toggle",
          role: "none",
          label: named ? title! : PRIMITIVES.has(node.class_type) && target ? `${pretty(target.input)} (${graph[target.node]?._meta?.title ?? info[target.classType]?.display_name ?? target.classType})` : pretty(input),
          exposed: PRIMITIVES.has(node.class_type) || named,
          advanced: false,
        });
        continue;
      }

      const options = enumOptions(spec);
      if (options) {
        const modelFile = options.some((o) => /\.(safetensors|ckpt|pt|pth|gguf|bin|sft)$/i.test(o));
        const aspect = input === "aspect_ratio" && options.some((o) => /^\d+(\.\d+)?:\d+/.test(o));
        push({
          kind: "choice",
          role: aspect ? "aspect" : "none",
          label: named ? `${title} ${pretty(input).toLowerCase()}` : pretty(input),
          options,
          exposed: input === "aspect_ratio" || input === "resolution" || ADVANCED_CHOICES.has(input) || (named && !modelFile),
          advanced: ADVANCED_CHOICES.has(input) || modelFile,
        });
        continue;
      }

      if (t === "INT" || t === "FLOAT") {
        const num = { min: typeof opts.min === "number" ? opts.min : undefined, max: typeof opts.max === "number" ? opts.max : undefined, step: typeof opts.step === "number" ? opts.step : undefined, integer: t === "INT" };
        if ((input === "width" || input === "height") && hasW) {
          push({ kind: "number", role: sizeTaken ? "none" : input, label: pretty(input), ...num, exposed: !sizeTaken, advanced: false });
          if (input === "height") sizeTaken = true;
          continue;
        }
        if (FRAME_NAMES.has(input)) {
          push({ kind: "number", role: "frames", label: "Length (frames)", ...num, exposed: true, advanced: false });
          continue;
        }
        if (PRIMITIVES.has(node.class_type)) {
          const target = consumers(graph, id, 2);
          const feedsLength = target.some((c) => FRAME_NAMES.has(c.input));
          const seconds = /duration|second|length|sec\b/i.test(title ?? "") || (t === "FLOAT" && feedsLength);
          push({
            kind: "number",
            role: seconds ? "seconds" : feedsLength ? "frames" : "none",
            label: named ? title! : seconds ? "Duration (s)" : target[0] ? pretty(target[0].input) : "Value",
            ...num,
            exposed: true,
            // An unnamed number that only feeds plumbing (switches) is a setting, not a control.
            advanced: !named && !seconds && !feedsLength,
          });
          continue;
        }
        push({ kind: "number", role: input === "steps" ? "steps" : "none", label: named ? `${title} ${pretty(input).toLowerCase()}` : pretty(input), ...num, exposed: ADVANCED_NUMBERS.has(input), advanced: true });
        continue;
      }

      if (t === "STRING" && PRIMITIVES.has(node.class_type)) {
        push({ kind: "text", role: "none", label: named ? title! : "Text", exposed: true, advanced: false });
      }
    }
  }
  return fields;
}

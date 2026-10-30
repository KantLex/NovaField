"use client";

// The live grade: a WebGL pass over the playing clip with the same steps NovaLensFilm runs on the
// GPU (look, chromatic aberration and gate weave, halation, anamorphic streak, vignette, grain).
// Blurs are sampled rather than exact and the grain and weave have their own random numbers, so
// it's a close preview; "Check exact" shows the real thing for one frame.

import { useEffect, useRef, useState } from "react";
import { LOOK_PARAMS } from "@/lib/cinema/grade";
import type { MatchShift } from "@/lib/cinema/match";
import type { FilmLab } from "@/lib/engines/specs";

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVideo;
uniform vec2 uRes;
uniform float uFrame;
uniform float uSplit;
uniform float uLookOn, uIntensity, uExposure, uSat, uContrast, uPivot, uMono, uTeal, uSilver, uVhs;
uniform mat3 uMix;
uniform vec3 uMonoW, uBlack, uWhite, uShadow, uHighlight;
uniform float uGrain, uHalation, uVignette, uChromatic, uStreak;
uniform vec2 uWeave;
uniform float uCExposure, uCContrast, uCSaturation, uCTemp, uCTint, uCFade, uGrainSize;
uniform float uMatchOn, uMatchAmt;
uniform vec3 uMFrom, uMScale, uMTo;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float curve(float x, float c, float p) {
  x = clamp(x, 0.0, 1.0);
  return x < p ? p * pow(max(x / p, 0.0), c) : 1.0 - (1.0 - p) * pow(max((1.0 - x) / (1.0 - p), 0.0), c);
}
vec3 look(vec3 x) {
  vec3 y = uMono > 0.5 ? vec3(dot(x, uMonoW)) : uMix * x;
  y *= uExposure;
  float L = luma(y);
  y = L + (y - L) * uSat;
  if (uTeal > 0.0) {
    L = luma(y);
    float chroma = clamp(max(max(y.r, y.g), y.b) - min(min(y.r, y.g), y.b), 0.0, 1.0);
    float warm = smoothstep(-0.10, 0.25, y.r - y.b);
    vec3 teal = vec3(dot(y, vec3(0.80, 0.10, 0.10)), dot(y, vec3(0.0, 0.70, 0.30)), dot(y, vec3(0.0, 0.42, 0.58)));
    y = y + (teal - y) * (1.0 - warm) * uTeal;
    vec3 push = warm * chroma * vec3(0.09, 0.02, -0.08) + (1.0 - warm) * (0.3 + chroma) * vec3(-0.05, 0.012, 0.035);
    y = y + uTeal * push * (0.3 + 0.7 * L);
  }
  y = vec3(curve(y.r, uContrast, uPivot), curve(y.g, uContrast, uPivot), curve(y.b, uContrast, uPivot));
  if (uSilver > 0.0) {
    L = luma(y);
    vec3 ov = L < 0.5 ? 2.0 * y * L : 1.0 - 2.0 * (1.0 - y) * (1.0 - L);
    y = y + (ov - y) * uSilver;
  }
  y = uBlack + y * (uWhite - uBlack);
  L = clamp(luma(y), 0.0, 1.0);
  y = y + (1.0 - L) * (1.0 - L) * uShadow + L * L * uHighlight;
  return clamp(y, 0.0, 1.0);
}
// Continuity: the clip's mean and spread in CIELAB moved onto the reference shot's (match_color.py).
const float LD = 6.0 / 29.0;
const vec3 WHITE = vec3(0.95047, 1.0, 1.08883);
const mat3 RGB2XYZ = mat3(0.4124564, 0.2126729, 0.0193339, 0.3575761, 0.7151522, 0.1191920, 0.1804375, 0.0721750, 0.9503041);
const mat3 XYZ2RGB = mat3(3.2404542, -0.9692660, 0.0556434, -1.5371385, 1.8760108, -0.2040259, -0.4985314, 0.0415560, 1.0572252);
vec3 rgb2lab(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lin = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  vec3 xyz = RGB2XYZ * lin / WHITE;
  vec3 f = mix(xyz / (3.0 * LD * LD) + 4.0 / 29.0, pow(max(xyz, vec3(1e-12)), vec3(1.0 / 3.0)), step(LD * LD * LD, xyz));
  return vec3(116.0 * f.y - 16.0, 500.0 * (f.x - f.y), 200.0 * (f.y - f.z));
}
vec3 lab2rgb(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  vec3 f = vec3(fy + lab.y / 500.0, fy, fy - lab.z / 200.0);
  vec3 xyz = mix(3.0 * LD * LD * (f - 4.0 / 29.0), f * f * f, step(LD, f)) * WHITE;
  vec3 lin = clamp(XYZ2RGB * xyz, 0.0, 1.0);
  return mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));
}
vec3 graded(vec2 uv) {
  vec3 x = texture2D(uVideo, clamp(uv, 0.0, 1.0)).rgb;
  if (uMatchOn > 0.5) x = mix(x, clamp(lab2rgb((rgb2lab(x) - uMFrom) * uMScale + uMTo), 0.0, 1.0), uMatchAmt);
  return uLookOn > 0.5 ? mix(x, look(x), uIntensity) : x;
}
// Tape: chroma smeared to the right, soft luma, faint scanlines (lens_film._vhs).
vec3 vhs(vec2 uv, vec3 c) {
  float px = 1.0 / uRes.x;
  float sx = max(uRes.x / 640.0, 0.5);
  float Y = 0.0; float wy = 0.0;
  vec2 ch = vec2(0.0); float wc = 0.0;
  for (int i = -6; i <= 6; i++) {
    float f = float(i);
    vec3 s = graded(uv + vec2(f * px * sx, 0.0));
    float y = 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
    float a = exp(-f * f / (2.0 * 0.75 * 0.75));
    Y += y * a; wy += a;
    float b = exp(-(f - 1.8) * (f - 1.8) / (2.0 * 2.6 * 2.6));
    ch += vec2(s.b - y, s.r - y) * b; wc += b;
  }
  Y /= wy; ch /= wc;
  float lines = 0.5 + 0.5 * cos(6.2831853 * (uv.y * uRes.y + 0.5) * (240.0 / uRes.y));
  Y *= 1.0 - 0.07 * lines;
  float r = Y + ch.y, b = Y + ch.x;
  return vec3(r, (Y - 0.299 * r - 0.114 * b) / 0.587, b);
}
// The colour controls after the look (lens_film.adjust), each skipped at 0.
vec3 correct(vec3 x) {
  x *= exp2(uCExposure);
  x *= vec3(1.0 + 0.12 * uCTemp + 0.04 * uCTint, 1.0 - 0.12 * uCTint, 1.0 - 0.12 * uCTemp + 0.04 * uCTint);
  float L = luma(x);
  x = L + (x - L) * (1.0 + uCSaturation);
  if (uCContrast != 0.0) {
    float c = exp2(uCContrast);
    x = vec3(curve(x.r, c, 0.5), curve(x.g, c, 0.5), curve(x.b, c, 0.5));
  }
  x = 0.1 * uCFade + clamp(x, 0.0, 1.0) * (1.0 - 0.25 * uCFade);
  return clamp(x, 0.0, 1.0);
}
vec3 at(vec2 uv) {
  vec3 c = graded(uv);
  c = uVhs > 0.5 && uLookOn > 0.5 ? mix(c, clamp(vhs(uv, c), 0.0, 1.0), uIntensity) : c;
  return correct(c);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gauss(vec2 p) {
  float u = max(hash(p), 1e-4), v = hash(p + 17.31);
  return sqrt(-2.0 * log(u)) * cos(6.2831853 * v);
}
// A highlight blur: rings of samples around uv, weighted like a Gaussian of size s (in uv).
float glow(vec2 uv, vec2 s, float lo) {
  float sum = 0.0, w = 0.0;
  for (int ring = 0; ring < 3; ring++) {
    float r = float(ring) * 0.9;
    float a = exp(-r * r / 2.0);
    for (int k = 0; k < 8; k++) {
      if (ring == 0 && k > 0) break;
      float t = float(k) * 0.7853982 + float(ring) * 0.39;
      float L = luma(at(uv + vec2(cos(t), sin(t)) * s * r));
      sum += smoothstep(lo, 1.0, L) * L * a; w += a;
    }
  }
  return sum / w;
}
float streak(vec2 uv, float s) {
  float sum = 0.0, w = 0.0;
  for (int i = -8; i <= 8; i++) {
    float f = float(i) / 8.0;
    float a = exp(-f * f * 2.0);
    float L = luma(at(uv + vec2(f * s * 2.0, 0.0)));
    sum += smoothstep(0.85, 1.0, L) * L * a; w += a;
  }
  return sum / w;
}
void main() {
  vec2 uv = vUv;
  if (uv.x < uSplit) { gl_FragColor = vec4(texture2D(uVideo, uv).rgb, 1.0); return; }
  vec2 p = uv * 2.0 - 1.0;
  vec2 off = -uWeave / uRes;
  float k = 0.006 * uChromatic;
  vec3 x = vec3(
    at(p * (1.0 - k) * 0.5 + 0.5 + off).r,
    at(uv + off).g,
    at(p * (1.0 + k) * 0.5 + 0.5 + off).b);
  if (uHalation > 0.0) {
    vec2 s = vec2(0.012 * uRes.y / uRes.x, 0.012);
    float b = 0.65 * glow(uv + off, s, 0.75) + 0.35 * glow(uv + off, s * 3.0, 0.75);
    x += uHalation * 1.1 * b * vec3(1.0, 0.36, 0.12);
  }
  if (uStreak > 0.0) {
    float b = 0.55 * streak(uv + off, 0.02) + 0.45 * streak(uv + off, 0.09);
    x += uStreak * 4.0 * b * vec3(0.30, 0.58, 1.0);
  }
  if (uVignette > 0.0) {
    float r = length(p) / 1.4142136;
    x *= 1.0 - uVignette * 0.8 * smoothstep(0.25, 1.0, r);
  }
  if (uGrain > 0.0) {
    // Bigger grain: noise on a coarser grid, smoothly interpolated and lifted back to the same strength.
    vec2 q = uv * uRes / uGrainSize;
    vec2 i0 = floor(q), t = smoothstep(0.0, 1.0, fract(q));
    vec2 o = uFrame * vec2(13.0, 7.0);
    vec3 n = vec3(0.0);
    for (int c = 0; c < 4; c++) {
      vec2 k = vec2(mod(float(c), 2.0), floor(float(c) / 2.0));
      float w = mix(1.0 - t.x, t.x, k.x) * mix(1.0 - t.y, t.y, k.y);
      vec2 cell = i0 + k + o;
      n += w * (vec3(gauss(cell)) + 0.3 * vec3(gauss(cell + 3.1), gauss(cell + 5.7), gauss(cell + 9.2)));
    }
    n *= uGrainSize > 1.01 ? 1.45 : 1.0;
    float L = clamp(luma(x), 0.0, 1.0);
    x += n * uGrain * 0.065 * (0.3 + 0.7 * 4.0 * L * (1.0 - L));
  }
  gl_FragColor = vec4(clamp(x, 0.0, 1.0), 1.0);
}`;

/** A smooth random walk per frame, about unit size (lens_film.weave_offsets, with its own random numbers). */
export function weaveWalk(frames: number, seed: number): [number, number][] {
  let s = (seed * 2654435761 + 97) >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randn = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand());
  const a = 0.8;
  const v: [number, number][] = [[randn(), randn()]];
  for (let i = 1; i < frames + 4; i++) v.push([a * v[i - 1][0] + Math.sqrt(1 - a * a) * randn(), a * v[i - 1][1] + Math.sqrt(1 - a * a) * randn()]);
  const k = [1, 2, 3, 2, 1].map((x) => x / 9);
  return Array.from({ length: frames }, (_, i) => [0, 1].map((c) => k.reduce((sum, w, j) => sum + w * v[i + j][c], 0) * 1.35) as [number, number]);
}

/**
 * Draws `video` graded with `film` on a canvas sized to its box. Left of `split` (0–1) shows the
 * clip untouched. Calls `onFail` when the browser has no WebGL, so the caller can say so.
 */
export function GradeCanvas({
  video,
  film,
  split,
  fps,
  seed,
  match = null,
  onFail,
  children,
}: {
  video: HTMLVideoElement | null;
  film: FilmLab;
  /** Continuity with another shot: the Lab shift to apply, and how much of it. */
  match?: (MatchShift & { amount: number }) | null;
  split: number;
  fps: number;
  seed: number;
  onFail: () => void;
  /** Laid over the picture itself (not its letterbox): the compare handle, an exact frame. */
  children?: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const settings = useRef({ film, split, fps, seed, match });
  const [ratio, setRatio] = useState(16 / 9);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useEffect(() => {
    settings.current = { film, split, fps, seed, match };
  }, [film, split, fps, seed, match]);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setRoom({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The largest picture of the clip's shape that fits the box.
  const fit = room.w / room.h > ratio ? { w: room.h * ratio, h: room.h } : { w: room.w, h: room.w / ratio };

  useEffect(() => {
    const c = canvas.current;
    if (!c || !video) return;
    const gl = c.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return onFail();
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch (e) {
      console.error(e);
      return onFail();
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const [k, v] of [
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    let walk: [number, number][] = [];
    let walkKey = "";
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (video.readyState < 2 || !video.videoWidth) return;
      const { film: f, split: sp, fps: rate, seed: sd, match: mt } = settings.current;
      const W = video.videoWidth;
      const H = video.videoHeight;
      setRatio((r) => (Math.abs(r - W / H) > 1e-3 ? W / H : r));
      // Draw at the size shown (not the clip's), so the blurs stay cheap.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      const frame = Math.floor(video.currentTime * rate);
      const frames = Math.max(1, Math.ceil((video.duration || 1) * rate));
      if (walkKey !== `${frames}:${sd}`) {
        walk = weaveWalk(frames, sd);
        walkKey = `${frames}:${sd}`;
      }
      const wv = walk[Math.min(frame, walk.length - 1)] ?? [0, 0];
      const p = f.look !== "none" ? LOOK_PARAMS[f.look] : null;
      gl.uniform2f(u("uRes"), W, H);
      gl.uniform1f(u("uFrame"), frame);
      gl.uniform1f(u("uSplit"), sp);
      gl.uniform1f(u("uLookOn"), p && f.intensity > 0 ? 1 : 0);
      gl.uniform1f(u("uIntensity"), f.intensity);
      if (p) {
        gl.uniform1f(u("uExposure"), p.exposure);
        gl.uniform1f(u("uSat"), p.sat);
        gl.uniform1f(u("uContrast"), p.contrast);
        gl.uniform1f(u("uPivot"), p.pivot);
        gl.uniform1f(u("uMono"), p.mono ? 1 : 0);
        gl.uniform3fv(u("uMonoW"), p.mono ?? [0, 0, 0]);
        gl.uniform1f(u("uTeal"), p.teal_orange ?? 0);
        gl.uniform1f(u("uSilver"), p.silver ?? 0);
        gl.uniform1f(u("uVhs"), p.vhs ? 1 : 0);
        // GLSL matrices are column-major: column c holds every output's weight for input c.
        gl.uniformMatrix3fv(u("uMix"), false, [0, 1, 2].flatMap((col) => [0, 1, 2].map((row) => p.mix[row][col])));
        gl.uniform3fv(u("uBlack"), p.black);
        gl.uniform3fv(u("uWhite"), p.white);
        gl.uniform3fv(u("uShadow"), p.shadow);
        gl.uniform3fv(u("uHighlight"), p.highlight);
      }
      gl.uniform1f(u("uMatchOn"), mt && mt.amount > 0 ? 1 : 0);
      if (mt) {
        gl.uniform1f(u("uMatchAmt"), mt.amount);
        gl.uniform3fv(u("uMFrom"), mt.from);
        gl.uniform3fv(u("uMScale"), mt.scale);
        gl.uniform3fv(u("uMTo"), mt.to);
      }
      gl.uniform1f(u("uGrain"), f.grain);
      gl.uniform1f(u("uHalation"), f.halation);
      gl.uniform1f(u("uVignette"), f.vignette);
      gl.uniform1f(u("uChromatic"), f.chromatic);
      gl.uniform1f(u("uStreak"), f.streak);
      gl.uniform1f(u("uCExposure"), f.exposure ?? 0);
      gl.uniform1f(u("uCContrast"), f.contrast ?? 0);
      gl.uniform1f(u("uCSaturation"), f.saturation ?? 0);
      gl.uniform1f(u("uCTemp"), f.temperature ?? 0);
      gl.uniform1f(u("uCTint"), f.tint ?? 0);
      gl.uniform1f(u("uCFade"), f.fade ?? 0);
      gl.uniform1f(u("uGrainSize"), Math.max(0.5, f.grainSize ?? 1));
      gl.uniform2f(u("uWeave"), wv[0] * 0.0018 * W * f.gateWeave, wv[1] * 0.0026 * H * f.gateWeave);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteTexture(tex);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [video, onFail]);

  return (
    <div ref={box} className="flex size-full items-center justify-center">
      <div className="relative" style={{ width: fit.w || "100%", height: fit.h || "100%" }}>
        <canvas ref={canvas} className="block size-full" />
        {children}
      </div>
    </div>
  );
}

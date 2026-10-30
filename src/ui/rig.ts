// Canvas twin of the NovaGhostRig scene (docs/contract.md §2) for live previs.

import { actorPositions, basis, BOX_EDGES, poseAt, project, propCorners, type Actor, type CameraBasis, type CameraPath, type Prop, type Vec3 } from "@/lib/cinema/camera";
import { ACTOR_COLORS } from "@/lib/cinema/custom";

type Seg = { a: Vec3; b: Vec3; kind: "grid" | "axis" | "pillar" | "subject" | "prop" };

function buildStage(): Seg[] {
  const segs: Seg[] = [];
  for (let i = -12; i <= 12; i++) {
    const kind = i === 0 ? "axis" : "grid";
    segs.push({ a: [i, 0, -12], b: [i, 0, 12], kind }, { a: [-12, 0, i], b: [12, 0, i], kind });
  }
  const pillars: [number, number][] = [
    [-4, -6],
    [4, -6],
    [-7, 0],
    [7, 0],
    [-4, 6],
    [4, 6],
  ];
  for (const [x, z] of pillars) {
    const h = 0.4;
    const c: Vec3[] = [
      [x - h, 0, z - h],
      [x + h, 0, z - h],
      [x + h, 0, z + h],
      [x - h, 0, z + h],
    ];
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      segs.push({ a, b, kind: "pillar" }, { a: [a[0], 3, a[2]], b: [b[0], 3, b[2]], kind: "pillar" }, { a, b: [a[0], 3, a[2]], kind: "pillar" });
    }
  }
  return segs;
}

function buildSubject(): Seg[] {
  const segs: Seg[] = [];
  const r = 0.32;
  const n = 24;
  for (let y = 0; y <= 1.75 + 1e-6; y += 0.15) {
    // Capsule: hemispherical ends shrink the ring radius near the top and bottom.
    const dy = y < r ? r - y : y > 1.75 - r ? y - (1.75 - r) : 0;
    const rr = Math.sqrt(Math.max(0, r * r - dy * dy));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      segs.push({ a: [Math.cos(a0) * rr, y, Math.sin(a0) * rr], b: [Math.cos(a1) * rr, y, Math.sin(a1) * rr], kind: "subject" });
    }
  }
  for (let m = 0; m < 8; m++) {
    const a = (m / 8) * Math.PI * 2;
    let prev: Vec3 | null = null;
    for (let y = 0; y <= 1.75 + 1e-6; y += 0.0875) {
      const dy = y < r ? r - y : y > 1.75 - r ? y - (1.75 - r) : 0;
      const rr = Math.sqrt(Math.max(0, r * r - dy * dy));
      const p: Vec3 = [Math.cos(a) * rr, y, Math.sin(a) * rr];
      if (prev) segs.push({ a: prev, b: p, kind: "subject" });
      prev = p;
    }
  }
  return segs;
}

function buildStars(): Vec3[] {
  let state = 1234 >>> 0;
  const draw = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const pts: Vec3[] = [];
  for (let i = 0; i < 2400; i++) {
    const a = draw();
    const b = draw();
    const c = draw();
    const theta = 2 * Math.PI * a;
    const phi = Math.acos(2 * b - 1);
    const r = 8 + 22 * c;
    pts.push([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)]);
  }
  return pts;
}

const STAGE = buildStage();
const SUBJECT = buildSubject();
const STARS = buildStars();

export type RigStyle = "stage" | "subject" | "starfield" | "parallax";

const COLORS = { grid: "58,58,54", axis: "120,120,110", pillar: "150,150,140", subject: "228,255,26", prop: "214,206,184" };

function propSegments(props: Prop[]): Seg[] {
  const out: Seg[] = [];
  for (const p of props) {
    const c = propCorners(p);
    for (const [i, j] of BOX_EDGES) out.push({ a: c[i], b: c[j], kind: "prop" });
  }
  return out;
}
const ACTOR_RGB = ACTOR_COLORS.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(","));

/** Stand-ins for this frame: each actor's capsule scaled to its height and moved to its mark. */
function actorSegments(actors: Actor[], positions: Vec3[]): (Seg & { rgb: string })[] {
  const out: (Seg & { rgb: string })[] = [];
  actors.forEach((a, i) => {
    const k = a.height / 1.75;
    const [ax, , az] = positions[i];
    const tf = (p: Vec3): Vec3 => [p[0] * k + ax, p[1] * k, p[2] * k + az];
    for (const s of SUBJECT) out.push({ a: tf(s.a), b: tf(s.b), kind: "subject", rgb: ACTOR_RGB[i % ACTOR_RGB.length] });
  });
  return out;
}

function clipToNear(b: CameraBasis, a: Vec3, c: Vec3): [Vec3, Vec3] | null {
  const near = 0.06;
  const za = (a[0] - b.pos[0]) * b.forward[0] + (a[1] - b.pos[1]) * b.forward[1] + (a[2] - b.pos[2]) * b.forward[2];
  const zc = (c[0] - b.pos[0]) * b.forward[0] + (c[1] - b.pos[1]) * b.forward[1] + (c[2] - b.pos[2]) * b.forward[2];
  if (za < near && zc < near) return null;
  if (za >= near && zc >= near) return [a, c];
  const t = (near - za) / (zc - za);
  const p: Vec3 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
  return za < near ? [p, c] : [a, p];
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: CameraBasis,
  style: RigStyle,
  lineScale = 1,
  cast?: { actors?: Actor[]; positions?: Vec3[]; props?: Prop[] },
  /** false leaves the canvas clear, to lay the wireframe over footage. */
  opaque = true,
) {
  if (opaque) {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, w, h);
  } else ctx.clearRect(0, 0, w, h);
  ctx.lineCap = "round";
  const lw = Math.max(0.6, (h / 480) * 1.15 * lineScale);

  if (style === "starfield") {
    for (const s of STARS) {
      const p = project(cam, s, w, h);
      if (!p || p[0] < -2 || p[1] < -2 || p[0] > w + 2 || p[1] > h + 2) continue;
      const fade = Math.max(0.15, 1 - (p[2] - 6) / 26);
      const size = Math.max(0.6, (2.2 * lw * 6) / p[2]);
      ctx.fillStyle = `rgba(232,232,220,${fade})`;
      ctx.fillRect(p[0] - size / 2, p[1] - size / 2, size, size);
    }
    return;
  }

  const figures = style === "subject" || style === "parallax";
  const set = cast?.props?.length ? [...STAGE, ...propSegments(cast.props)] : STAGE;
  const segs: (Seg & { rgb?: string })[] = !figures ? set : cast?.actors && cast.positions ? [...set, ...actorSegments(cast.actors, cast.positions)] : [...set, ...SUBJECT];
  for (const s of segs) {
    const clipped = clipToNear(cam, s.a, s.b);
    if (!clipped) continue;
    const p = project(cam, clipped[0], w, h);
    const q = project(cam, clipped[1], w, h);
    if (!p || !q) continue;
    const z = (p[2] + q[2]) / 2;
    const fade = Math.max(0.12, Math.min(1, 1.15 - z / 22));
    ctx.strokeStyle = `rgba(${s.rgb ?? COLORS[s.kind]},${fade})`;
    ctx.lineWidth = s.kind === "subject" ? lw * 1.2 : lw;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
  }
}

const castAt = (path: CameraPath, frame: number) => ({
  ...(path.actors ? { actors: path.actors, positions: actorPositions(path, frame) } : {}),
  props: path.props,
});

export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, path: CameraPath, frame: number, style: RigStyle, opaque = true) {
  drawScene(ctx, w, h, basis(poseAt(path, frame)), style, 1, castAt(path, frame), opaque);
}

/** Bird's-eye view: the set from above, the camera's path in tungsten and its frustum at `frame`. */
export function drawOverview(ctx: CanvasRenderingContext2D, w: number, h: number, path: CameraPath, frame: number, style: RigStyle) {
  const cam = basis({ pos: [9, 11, 12], target: [0, 0.6, 0], fov: 42, roll: 0 });
  drawScene(ctx, w, h, cam, style === "starfield" ? "stage" : style, 0.8, castAt(path, frame));

  ctx.lineWidth = Math.max(1.2, h / 300);
  ctx.strokeStyle = "rgba(228,255,26,0.85)";
  ctx.beginPath();
  let started = false;
  const n = Math.min(path.frames, 160);
  for (let i = 0; i < n; i++) {
    const f = Math.round((i / Math.max(1, n - 1)) * (path.frames - 1));
    const p = project(cam, poseAt(path, f).pos, w, h);
    if (!p) continue;
    if (!started) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
    started = true;
  }
  ctx.stroke();

  const pose = poseAt(path, frame);
  const b = basis(pose);
  const depth = 1.1;
  const halfH = Math.tan((pose.fov * Math.PI) / 360) * depth;
  const halfW = halfH * (16 / 9);
  const corner = (sx: number, sy: number): Vec3 => [
    b.pos[0] + b.forward[0] * depth + b.right[0] * halfW * sx + b.up[0] * halfH * sy,
    b.pos[1] + b.forward[1] * depth + b.right[1] * halfW * sx + b.up[1] * halfH * sy,
    b.pos[2] + b.forward[2] * depth + b.right[2] * halfW * sx + b.up[2] * halfH * sy,
  ];
  const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const apex = project(cam, b.pos, w, h);
  const pc = corners.map((c) => project(cam, c, w, h));
  if (apex && pc.every(Boolean)) {
    ctx.fillStyle = "rgba(228,255,26,0.18)";
    ctx.strokeStyle = "rgba(228,255,26,1)";
    ctx.beginPath();
    pc.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const p of pc) {
      ctx.beginPath();
      ctx.moveTo(apex[0], apex[1]);
      ctx.lineTo(p![0], p![1]);
      ctx.stroke();
    }
    ctx.fillStyle = "#E4FF1A";
    ctx.beginPath();
    ctx.arc(apex[0], apex[1], Math.max(3, h / 120), 0, Math.PI * 2);
    ctx.fill();
  }
}

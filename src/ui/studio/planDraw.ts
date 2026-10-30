// Drawing the floor plan: the set, the stand-ins' walks, the camera's path with each leg's distance
// and speed, the live camera wedge and the handles. One frame at a time, from state.

import { actorPositions, poseAt, propCorners, type CameraPath, type Vec3 } from "@/lib/cinema/camera";
import { ACTOR_COLORS } from "@/lib/cinema/custom";
import { previsFrame } from "../previs";
import { handles, keyLabel, PILLARS, PROP_RGB, toScreen, TUNGSTEN, type Handle, type legs, type View } from "./planGeometry";
import { tr } from "@/i18n";

export interface PlanState {
  /** The shot's whole path, to play through. */
  path: CameraPath;
  /** The marks being edited (a preset reduced to a few). */
  editable: CameraPath;
  sel: Handle | null;
  aspect: number;
  legInfo: ReturnType<typeof legs>;
}

/** Draw one frame of the plan, w×h pixels, already scaled for the screen. */
export function drawPlan(ctx: CanvasRenderingContext2D, w: number, h: number, st: PlanState, view: View) {
  const { path: p, editable: e, sel: s, aspect: ar, legInfo: lg } = st;
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, w, h);
  const S = (x: number, z: number) => toScreen(view, x, z, w, h);

  // Floor grid.
  ctx.lineWidth = 1;
  for (let i = -12; i <= 12; i++) {
    ctx.strokeStyle = i === 0 ? "rgba(120,120,110,0.7)" : "rgba(58,58,54,0.8)";
    let a = S(i, -12);
    let b = S(i, 12);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    a = S(-12, i);
    b = S(12, i);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(150,150,140,0.8)";
  for (const [x, z] of PILLARS) {
    const a = S(x - 0.4, z - 0.4);
    const sz = 0.8 * view.scale;
    ctx.strokeRect(a[0], a[1], sz, sz);
  }

  // The monitor's previs clock: the plan pauses and scrubs with the timeline.
  const f = previsFrame(p.frames);

  // Set pieces: their footprint, name and height.
  ctx.font = "500 11px var(--font-instrument), system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  (e.props ?? []).forEach((pr, i) => {
    const c = propCorners(pr);
    const active = s?.kind === "prop" && s.i === i;
    ctx.beginPath();
    [0, 1, 3, 2].forEach((k, j) => {
      const P = S(c[k][0], c[k][2]);
      if (j) ctx.lineTo(P[0], P[1]);
      else ctx.moveTo(P[0], P[1]);
    });
    ctx.closePath();
    ctx.fillStyle = `rgba(${PROP_RGB},${active ? 0.2 : 0.1})`;
    ctx.fill();
    ctx.strokeStyle = active ? "#fff" : `rgba(${PROP_RGB},0.8)`;
    ctx.lineWidth = active ? 2 : 1.25;
    ctx.stroke();
    const M = S(pr.at[0], pr.at[1]);
    ctx.fillStyle = `rgba(${PROP_RGB},0.9)`;
    ctx.fillText(`${tr(pr.label ?? "Box")} · ${pr.size[1].toFixed(2)}m`, M[0], M[1]);
  });

  // Stand-in walks.
  (p.actors ?? []).forEach((a, i) => {
    const col = ACTOR_COLORS[i % ACTOR_COLORS.length];
    const A = S(a.from[0], a.from[1]);
    const B = S(a.to[0], a.to[1]);
    if (A[0] !== B[0] || A[1] !== B[1]) {
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // Camera path through the shot.
  ctx.strokeStyle = "rgba(228,255,26,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const q = poseAt(p, Math.round((i / 60) * (p.frames - 1))).pos;
    const P = S(q[0], q[2]);
    if (i) ctx.lineTo(P[0], P[1]);
    else ctx.moveTo(P[0], P[1]);
  }
  ctx.stroke();

  // Each leg between marks: how far, and how fast. Fast legs blur and drift in the render.
  ctx.font = "600 10.5px var(--font-instrument), system-ui";
  for (const leg of lg) {
    // Only label legs long enough on screen to hold the text.
    if (leg.dist >= 0.05 && leg.dist * view.scale < 90) continue;
    const P = S(leg.mid[0], leg.mid[2]);
    const speed = leg.secs > 0 ? leg.dist / leg.secs : 0;
    const text = leg.dist < 0.05 ? `hold ${leg.secs.toFixed(1)}s` : `${leg.dist.toFixed(1)}m · ${speed.toFixed(1)}m/s${speed > 3 ? " fast" : ""}`;
    const tw = ctx.measureText(text).width + 10;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(P[0] - tw / 2, P[1] + 9, tw, 15);
    ctx.fillStyle = speed > 3 ? "#e5484d" : "rgba(244,244,236,0.85)";
    ctx.fillText(text, P[0], P[1] + 17);
  }

  // Each mark looks at its aim dot.
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(228,255,26,0.45)";
  for (const k of e.keys) {
    const A = S(k.pos[0], k.pos[2]);
    const B = S(k.target[0], k.target[2]);
    ctx.beginPath();
    ctx.moveTo(A[0], A[1]);
    ctx.lineTo(B[0], B[1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Live camera: frustum wedge for the current frame.
  const pose = poseAt(p, f);
  const C = S(pose.pos[0], pose.pos[2]);
  const yaw = Math.atan2(pose.target[2] - pose.pos[2], pose.target[0] - pose.pos[0]);
  const halfH = Math.atan(Math.tan((pose.fov * Math.PI) / 360) * ar);
  const len = 2.2 * view.scale;
  ctx.fillStyle = "rgba(228,255,26,0.16)";
  ctx.strokeStyle = "rgba(228,255,26,0.9)";
  ctx.beginPath();
  ctx.moveTo(C[0], C[1]);
  ctx.lineTo(C[0] + Math.cos(yaw - halfH) * len, C[1] + Math.sin(yaw - halfH) * len);
  ctx.lineTo(C[0] + Math.cos(yaw + halfH) * len, C[1] + Math.sin(yaw + halfH) * len);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Stand-ins where they are right now.
  actorPositions(p, f).forEach((q: Vec3, i) => {
    const P = S(q[0], q[2]);
    const a = p.actors![i];
    ctx.fillStyle = ACTOR_COLORS[i % ACTOR_COLORS.length];
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(P[0], P[1], Math.max(5, 0.32 * (a.height / 1.75) * view.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // Handles on top.
  const n = e.keys.length;
  ctx.font = "600 11px var(--font-instrument), system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const { h: hd, x, z } of handles(e)) {
    if (hd.kind === "prop") continue;
    const P = S(x, z);
    const active = s && s.kind === hd.kind && s.i === hd.i;
    if (hd.kind === "cam") {
      const r = hd.i === 0 || hd.i === n - 1 ? 10 : 7;
      ctx.fillStyle = TUNGSTEN;
      ctx.beginPath();
      ctx.arc(P[0], P[1], r, 0, Math.PI * 2);
      ctx.fill();
      if (active) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = "#1d1408";
      ctx.fillText(keyLabel(hd.i, n), P[0], P[1] + 0.5);
    } else if (hd.kind === "aim") {
      ctx.strokeStyle = active ? "#fff" : TUNGSTEN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(P[0], P[1], 5, 0, Math.PI * 2);
      ctx.moveTo(P[0] - 14, P[1]);
      ctx.lineTo(P[0] + 14, P[1]);
      ctx.moveTo(P[0], P[1] - 14);
      ctx.lineTo(P[0], P[1] + 14);
      ctx.stroke();
    } else {
      const col = ACTOR_COLORS[hd.i % ACTOR_COLORS.length];
      ctx.lineWidth = 2;
      ctx.strokeStyle = active ? "#fff" : col;
      ctx.fillStyle = hd.kind === "from" ? col : "#050505";
      ctx.beginPath();
      ctx.arc(P[0], P[1], 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = hd.kind === "from" ? "#111" : col;
      ctx.fillText(String(hd.i + 1), P[0], P[1] + 0.5);
    }
  }
}

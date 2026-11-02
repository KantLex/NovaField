// The 3D plan: the previs set (../three/previsSet.ts) orbited with the mouse, with the editing
// aids on top: the camera's path, its marks (at their real height, with a stalk to the floor) and
// aims, the stand-ins' marks and facing arrows, and the camera itself. The marks are dragged across
// the floor, or up and down with Shift. Every pose comes from the shared camera maths, so the move
// matches the plan, the lens view and the render. Loaded on demand, with three.js.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { basis, poseAt, propCorners, type CameraPath, type Vec3 } from "@/lib/cinema/camera";
import { ACTOR_COLORS, walks } from "@/lib/cinema/custom";
import type { LightFrom } from "@/lib/cinema/looks";
import { previsFrame } from "../previs";
import { aimLens, previsSet } from "../three/previsSet";
import { facePoint, handles, HEIGHTS, inProp, keyLabel, lineOfAction, rayToHeight, rayToLevel, TUNGSTEN, type Handle } from "./planGeometry";

export interface Plan3DState {
  /** The shot as it plays. */
  path: CameraPath;
  /** The same shot with the marks being edited as its keys. */
  editable: CameraPath;
  sel: Handle | null;
  aspect: number;
  inset: boolean;
  /** Which side the key light comes from. */
  light: LightFrom;
}

export interface Plan3DHooks {
  select: (h: Handle | null) => void;
  /** A drag is starting: a new undo step. */
  grab: () => void;
  /** Move a handle to floor (x, z), and for a camera mark or aim, to height y. */
  move: (h: Handle, x: number, z: number, y?: number) => void;
}

export interface Plan3D {
  /** Frame everything on the set. */
  fit: () => void;
  dispose: () => void;
}

// Editing aids (handles, the path, the camera body) live on this layer, which the lens doesn't see.
const GIZMO = 1;
const snap = (v: number) => Math.round(v * 20) / 20;
const same = (a: Handle | null, b: Handle) => !!a && a.kind === b.kind && a.i === b.i;

export function createPlan3D(canvas: HTMLCanvasElement, labelLayer: HTMLElement, read: () => Plan3DState, hooks: () => Plan3DHooks, insetEl: () => HTMLElement | null): Plan3D {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const set = previsSet(scene, renderer, GIZMO);

  // Everything made here is disposed at the end; per-edit geometry goes in `temp`.
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(x: T) => (owned.push(x), x);
  let temp: THREE.BufferGeometry[] = [];
  const tmp = <T extends THREE.BufferGeometry>(g: T) => (temp.push(g), g);
  const onGizmo = <T extends THREE.Object3D>(o: T) => (o.traverse((c) => c.layers.set(GIZMO)), o);

  const mat = {
    path: own(new THREE.LineBasicMaterial({ color: TUNGSTEN })),
    cam: own(new THREE.MeshBasicMaterial({ color: TUNGSTEN })),
    aim: own(new THREE.MeshBasicMaterial({ color: 0xf4f4ec })),
    picked: own(new THREE.MeshBasicMaterial({ color: 0xffffff })),
    stalk: own(new THREE.LineDashedMaterial({ color: TUNGSTEN, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.6 })),
    sight: own(new THREE.LineBasicMaterial({ color: 0xf4f4ec, transparent: true, opacity: 0.35 })),
    axis: own(new THREE.LineDashedMaterial({ color: 0xff785a, dashSize: 0.3, gapSize: 0.22, transparent: true, opacity: 0.6 })),
    body: own(new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.5, metalness: 0.3 })),
    frustum: own(new THREE.LineBasicMaterial({ color: TUNGSTEN, transparent: true, opacity: 0.8 })),
  };
  const actorMats = ACTOR_COLORS.map((c) => ({
    line: own(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.7 })),
    disc: own(new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, side: THREE.DoubleSide })),
  }));
  const sphere = own(new THREE.SphereGeometry(1, 20, 14));
  // A flat arrowhead, tip at -y: laid on the floor (x turned -90°) it points along +z and faces up.
  const arrowHead = own(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, -1), new THREE.Vector2(0.8, 0.6), new THREE.Vector2(-0.8, 0.6)])));
  const octa = own(new THREE.OctahedronGeometry(1));
  const disc = own(new THREE.CircleGeometry(1, 28));
  const ring = own(new THREE.RingGeometry(0.85, 1, 28));

  // The camera being planned, at the current frame: a body, its lens and what it sees.
  const rigCam = new THREE.Group();
  const bodyMesh = new THREE.Mesh(own(new THREE.BoxGeometry(0.2, 0.15, 0.26)), mat.body);
  bodyMesh.position.z = 0.13;
  const lensMesh = new THREE.Mesh(own(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 16)), mat.body);
  lensMesh.rotation.x = Math.PI / 2;
  lensMesh.position.z = -0.04;
  const frustumGeo = own(new THREE.BufferGeometry());
  frustumGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  const frustum = new THREE.LineSegments(frustumGeo, mat.frustum);
  rigCam.add(bodyMesh, lensMesh, frustum);
  scene.add(onGizmo(rigCam));

  const edit = new THREE.Group();
  scene.add(edit);

  const view = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  view.layers.enable(GIZMO);
  const lens = new THREE.PerspectiveCamera(40, 1, 0.05, 200);

  // Our pointer handler goes first, so a grab on a handle can switch the orbit off before it starts.
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  const controls = new OrbitControls(view, canvas);
  controls.enableDamping = true;
  controls.minDistance = 1;
  controls.maxDistance = 60;
  // Never under the floor.
  controls.maxPolarAngle = Math.PI * 0.495;

  let last: Plan3DState | null = null;
  let labels: { el: HTMLElement; at: Vec3 }[] = [];

  function rebuild(s: Plan3DState) {
    for (const g of temp) g.dispose();
    temp = [];
    edit.clear();
    const { path, editable, sel } = s;

    // The path the camera travels.
    const n = Math.min(path.frames, 160);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(...poseAt(path, Math.round((i / Math.max(1, n - 1)) * (path.frames - 1))).pos));
    edit.add(new THREE.Line(tmp(new THREE.BufferGeometry().setFromPoints(pts)), mat.path));

    // Camera marks at their height, a stalk down to the floor, and a line of sight to each aim.
    editable.keys.forEach((k, i) => {
      const cam = new THREE.Mesh(sphere, same(sel, { kind: "cam", i }) ? mat.picked : mat.cam);
      cam.position.set(...k.pos);
      cam.scale.setScalar(same(sel, { kind: "cam", i }) ? 0.13 : 0.1);
      const aim = new THREE.Mesh(octa, same(sel, { kind: "aim", i }) ? mat.picked : mat.aim);
      aim.position.set(...k.target);
      aim.scale.setScalar(same(sel, { kind: "aim", i }) ? 0.1 : 0.07);
      const stalk = new THREE.Line(tmp(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...k.pos), new THREE.Vector3(k.pos[0], 0, k.pos[2])])), mat.stalk);
      stalk.computeLineDistances();
      const foot = new THREE.Mesh(ring, mat.cam);
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(k.pos[0], 0.01, k.pos[2]);
      foot.scale.setScalar(0.14);
      const sight = new THREE.Line(tmp(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...k.pos), new THREE.Vector3(...k.target)])), mat.sight);
      edit.add(cam, aim, stalk, foot, sight);
    });

    // Stand-ins' marks on the floor and the line they walk.
    (path.actors ?? []).forEach((a, i) => {
      const m = actorMats[i % actorMats.length];
      const walking = walks(a);
      const marks: ["from" | "to", [number, number]][] = walking ? [["from", a.from], ["to", a.to]] : [["from", a.from]];
      for (const [kind, [x, z]] of marks) {
        const d = new THREE.Mesh(same(sel, { kind, i }) ? ring : disc, same(sel, { kind, i }) ? mat.picked : m.disc);
        d.rotation.x = -Math.PI / 2;
        d.position.set(x, 0.015, z);
        d.scale.setScalar(kind === "from" ? 0.24 : 0.16);
        edit.add(d);
      }
      if (walking) edit.add(new THREE.Line(tmp(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.from[0], 0.02, a.from[1]), new THREE.Vector3(a.to[0], 0.02, a.to[1])])), m.line));
      else {
        // The way it faces: a line out from its mark to an arrowhead, dragged round to turn it.
        const [fx, fz] = facePoint(a, editable.keys[0].pos);
        const picked = same(sel, { kind: "face", i });
        edit.add(new THREE.Line(tmp(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.from[0], 0.02, a.from[1]), new THREE.Vector3(fx, 0.02, fz)])), m.line));
        const head = new THREE.Mesh(arrowHead, picked ? mat.picked : m.disc);
        head.position.set(fx, 0.02, fz);
        head.rotation.order = "YXZ";
        head.rotation.set(-Math.PI / 2, Math.atan2(fx - a.from[0], fz - a.from[1]), 0);
        head.scale.setScalar(picked ? 0.15 : 0.12);
        edit.add(head);
      }
    });

    // The line of action between the first two people, on the floor.
    const axis = lineOfAction(path);
    if (axis) {
      const line = new THREE.Line(tmp(new THREE.BufferGeometry().setFromPoints(axis.map(([x, z]) => new THREE.Vector3(x, 0.012, z)))), mat.axis);
      line.computeLineDistances();
      edit.add(line);
    }

    onGizmo(edit);

    // Mark labels, as on the floor plan.
    for (const l of labels) l.el.remove();
    labels = editable.keys.map((k, i) => {
      const el = document.createElement("span");
      el.textContent = keyLabel(i, editable.keys.length);
      el.className = "readout pointer-events-none absolute top-0 left-0 rounded bg-black/70 px-1 text-[12px] font-semibold text-tungsten";
      labelLayer.appendChild(el);
      return { el, at: k.pos };
    });
  }

  /** The planned camera at this frame: its body and what it sees. */
  function placeCamera(path: CameraPath, frame: number, aspect: number) {
    const pose = poseAt(path, frame);
    const b = basis(pose);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...b.right), new THREE.Vector3(...b.up), new THREE.Vector3(...b.forward).negate());
    rigCam.position.set(...pose.pos);
    rigCam.quaternion.setFromRotationMatrix(m);
    const depth = 1.1;
    const hh = Math.tan((pose.fov * Math.PI) / 360) * depth;
    const hw = hh * aspect;
    const c = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
    const arr = frustumGeo.attributes.position.array as Float32Array;
    let o = 0;
    const put = (x: number, y: number, z: number) => {
      arr[o++] = x;
      arr[o++] = y;
      arr[o++] = z;
    };
    for (let i = 0; i < 4; i++) {
      put(0, 0, 0);
      put(c[i][0], c[i][1], -depth);
      put(c[i][0], c[i][1], -depth);
      put(c[(i + 1) % 4][0], c[(i + 1) % 4][1], -depth);
    }
    frustumGeo.attributes.position.needsUpdate = true;
    frustumGeo.computeBoundingSphere();
  }

  function fit() {
    const s = read();
    const pts: Vec3[] = [[0, 0, 0]];
    for (const k of s.editable.keys) pts.push(k.pos, k.target);
    for (const a of s.path.actors ?? []) pts.push([a.from[0], 0, a.from[1]], [a.to[0], 0, a.to[1]]);
    for (const p of s.editable.props ?? []) pts.push(...propCorners(p));
    const box = new THREE.Box3().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(1.8, box.getSize(new THREE.Vector3()).length() / 2) + 0.4;
    const dist = r / Math.tan((view.fov * Math.PI) / 360);
    view.position.copy(center).add(new THREE.Vector3(0.55, 0.7, 1).normalize().multiplyScalar(dist));
    controls.target.set(center.x, Math.min(center.y, 1), center.z);
    controls.update();
  }

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    view.aspect = w / h;
    view.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  fit();

  const v = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const s = read();
    if (!last || s.path !== last.path || s.editable !== last.editable || s.sel !== last.sel) rebuild(s);
    last = s;
    set.light(s.light);
    set.sync(s.path, s.sel?.kind === "prop" ? s.sel.i : null);
    controls.update();
    const frame = previsFrame(s.path.frames);
    set.place(s.path, frame);
    placeCamera(s.path, frame, s.aspect);

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.render(scene, view);

    for (const l of labels) {
      v.set(l.at[0], l.at[1] + 0.22, l.at[2]).project(view);
      const hidden = v.z > 1;
      l.el.style.display = hidden ? "none" : "";
      if (!hidden) l.el.style.transform = `translate(${((v.x + 1) / 2) * w + 6}px, ${((1 - v.y) / 2) * h - 10}px)`;
    }

    // What the lens sees, in the picture-in-picture: the same set, without the editing aids.
    const inset = s.inset ? insetEl() : null;
    if (inset) {
      const r = inset.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const x = r.left - c.left;
        const y = c.bottom - r.bottom;
        aimLens(lens, s.path, frame, r.width / r.height);
        renderer.setViewport(x, y, r.width, r.height);
        renderer.setScissor(x, y, r.width, r.height);
        renderer.setScissorTest(true);
        renderer.render(scene, lens);
        renderer.setScissorTest(false);
      }
    }
  });

  // Picking and dragging. Handles are picked on screen, like the floor plan: nearest within reach.
  const raycaster = new THREE.Raycaster();
  function ray(e: PointerEvent): [Vec3, Vec3] {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), view);
    const { origin: o, direction: d } = raycaster.ray;
    return [
      [o.x, o.y, o.z],
      [d.x, d.y, d.z],
    ];
  }
  function pick(e: PointerEvent): Handle | null {
    const s = read();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    let best: Handle | null = null;
    let bestD = 16;
    for (const { h, x, y, z } of handles(s.editable)) {
      if (h.kind === "prop") continue;
      v.set(x, y, z).project(view);
      if (v.z > 1) continue;
      const d = Math.hypot(((v.x + 1) / 2) * r.width - sx, ((1 - v.y) / 2) * r.height - sy);
      if (d <= bestD) {
        best = h;
        bestD = d + 0.01;
      }
    }
    if (best) return best;
    // A set piece anywhere on it: where the pointer meets its floor or its middle.
    const [o, d] = ray(e);
    const props = s.editable.props ?? [];
    for (let i = props.length - 1; i >= 0; i--) {
      for (const y of [props[i].size[1] / 2, 0]) {
        const at = rayToLevel(o, d, y);
        if (at && inProp(props[i], at[0], at[1])) return { kind: "prop", i };
      }
    }
    return null;
  }

  let drag: { h: Handle; offset: [number, number] } | null = null;
  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const h = pick(e);
    hooks().select(h);
    if (!h) return;
    controls.enabled = false;
    // Keep the drag when the pointer leaves the canvas (not possible for every pointer, e.g. a synthetic one).
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    let offset: [number, number] = [0, 0];
    if (h.kind === "prop") {
      const p = read().editable.props![h.i];
      const [o, d] = ray(e);
      const at = rayToLevel(o, d, p.size[1] / 2);
      if (at) offset = [p.at[0] - at[0], p.at[1] - at[1]];
    }
    drag = { h, offset };
    hooks().grab();
  }
  function onMove(e: PointerEvent) {
    if (!drag) {
      canvas.style.cursor = pick(e) ? "grab" : "";
      return;
    }
    canvas.style.cursor = "grabbing";
    const { h, offset } = drag;
    const s = read();
    const at = handles(s.editable).find((x) => same(h, x.h));
    if (!at) return;
    const [o, d] = ray(e);
    if ((h.kind === "cam" || h.kind === "aim") && e.shiftKey) {
      // Shift: up and down, staying on the same spot on the floor.
      const y = rayToHeight(o, d, [at.x, at.y, at.z]);
      if (y === null) return;
      const [lo, hi] = HEIGHTS[h.kind];
      hooks().move(h, at.x, at.z, Math.min(hi, Math.max(lo, snap(y))));
      return;
    }
    const p = rayToLevel(o, d, at.y);
    if (p) hooks().move(h, snap(p[0] + offset[0]), snap(p[1] + offset[1]));
  }
  function onUp(e: PointerEvent) {
    if (!drag) return;
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = "";
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  }

  return {
    fit,
    dispose: () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      controls.dispose();
      for (const l of labels) l.el.remove();
      for (const g of temp) g.dispose();
      for (const x of owned) x.dispose();
      set.dispose();
      renderer.dispose();
      // Hand the context back now: browsers hold only a few, and drop the oldest past that.
      renderer.forceContextLoss();
    },
  };
}

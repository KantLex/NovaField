// The previs set in three.js: the stage (floor grid and pillars, as in the ghost rig), set pieces
// (shaped like what they are, or the 3D takes placed in them) and the stand-ins (block figures doing their motions,
// or 3D takes), lit for a clean read. The 3D plan, the monitor's lens view and the guide video H3
// follows all show this same set, so what you plan is what the take is shown.

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { actorPositions, basis, poseAt, type CameraPath, type Vec3 } from "@/lib/cinema/camera";
import { ACTOR_COLORS, DEFAULT_ACTOR, facingOf, walks } from "@/lib/cinema/custom";
import { mannequin, STRIDE, type Mannequin } from "./mannequin";
import { copyModel, fittedModel } from "./models";
import { pieceShape } from "./setPieces";

/** Ghost-rig pillar spots on the floor (contract §2). */
const PILLARS: [number, number][] = [
  [-4, -6],
  [4, -6],
  [-7, 0],
  [7, 0],
  [-4, 6],
  [4, 6],
];
export const SET_BG = 0x0b0b0c;
const PROP = new THREE.Color("rgb(214,206,184)");

export interface PrevisSet {
  /** Match the set to a path's set pieces and stand-ins. Cheap when nothing changed; `picked` outlines a set piece. */
  sync: (path: CameraPath, picked?: number | null) => void;
  /** Stand-ins where they are at this frame: on their marks, facing their way, mid-stride or mid-motion. */
  place: (path: CameraPath, frame: number) => void;
  /** Settles once every 3D take asked for so far has loaded (or failed); sync again after it. */
  ready: () => Promise<void>;
  /** True while a 3D take is still loading. */
  loading: () => boolean;
  dispose: () => void;
}

/** Who stands in the set: the path's stand-ins, or for a preset move the one figure the ghost rig puts at the centre. */
const castOf = (path: CameraPath) => path.actors ?? DEFAULT_CAST;
const DEFAULT_CAST = [DEFAULT_ACTOR];

/** Put a camera where the shot's camera is at this frame, roll and lens included. */
export function aimLens(cam: THREE.PerspectiveCamera, path: CameraPath, frame: number, aspect: number) {
  const pose = poseAt(path, frame);
  const b = basis(pose);
  cam.fov = pose.fov;
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
  cam.position.set(...pose.pos);
  cam.up.set(...b.up);
  cam.lookAt(...pose.target);
}

/** Lights, background and stage for a scene drawn by `renderer`. `gizmo` is the layer selection outlines go on. */
export function previsSet(scene: THREE.Scene, renderer: THREE.WebGLRenderer, gizmo = 1): PrevisSet {
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(x: T) => (owned.push(x), x);
  let temp: THREE.BufferGeometry[] = [];
  const tmp = <T extends THREE.BufferGeometry>(g: T) => (temp.push(g), g);

  scene.background = new THREE.Color(SET_BG);
  scene.fog = new THREE.Fog(SET_BG, 20, 42);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
  room.dispose();
  const key = new THREE.DirectionalLight(0xfff1dc, 1.5);
  key.position.set(4, 8, 5);
  scene.add(key, new THREE.HemisphereLight(0xdfe8ff, 0x1a1612, 0.6));

  const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(24, 24)), own(new THREE.MeshStandardMaterial({ color: 0x121211, roughness: 1 })));
  floor.rotation.x = -Math.PI / 2;
  const grid = new THREE.GridHelper(24, 24, 0x6b6b62, 0x2c2c28);
  grid.position.y = 0.002;
  own(grid.geometry);
  own(grid.material as THREE.Material);
  scene.add(floor, grid);
  const pillarEdges = own(new THREE.EdgesGeometry(own(new THREE.BoxGeometry(0.8, 3, 0.8))));
  const pillarMat = own(new THREE.LineBasicMaterial({ color: 0x8a8a80, transparent: true, opacity: 0.45 }));
  for (const [x, z] of PILLARS) {
    const p = new THREE.LineSegments(pillarEdges, pillarMat);
    p.position.set(x, 1.5, z);
    scene.add(p);
  }

  const mat = {
    box: own(new THREE.MeshStandardMaterial({ color: PROP, roughness: 0.8, transparent: true, opacity: 0.35, depthWrite: false })),
    boxEdge: own(new THREE.LineBasicMaterial({ color: PROP })),
    picked: own(new THREE.LineBasicMaterial({ color: 0xffffff })),
    clay: own(new THREE.MeshStandardMaterial({ color: PROP, roughness: 0.85 })),
    dark: own(new THREE.MeshStandardMaterial({ color: 0x6b675d, roughness: 0.7 })),
  };
  const sets = new THREE.Group();
  scene.add(sets);

  // 3D takes, fitted once per file and size; each place they appear gets its own copy.
  const models = new Map<string, THREE.Group | "loading" | "failed">();
  let dirty = true;
  const pending = new Set<Promise<unknown>>();
  const modelFor = (url: string, box: Vec3): { id: string; model: THREE.Group } | null => {
    const id = `${url}|${box.join(",")}`;
    const got = models.get(id);
    if (got === undefined) {
      models.set(id, "loading");
      const load = fittedModel(url, box);
      pending.add(load);
      void load.finally(() => pending.delete(load)).catch(() => {});
      load.then(
        (g) => {
          models.set(id, g);
          dirty = true;
        },
        () => {
          models.set(id, "failed");
          dirty = true;
        },
      );
    }
    return got instanceof THREE.Group ? { id, model: got } : null;
  };

  // Stand-ins are kept between edits so their motion is smooth; set pieces (a 3D take's copy, or a
  // shape and the geometry it owns) while their model, name and size stay the same.
  const figures: { id: string; obj: THREE.Object3D; man?: Mannequin }[] = [];
  type Piece = { id: string; obj: THREE.Object3D; geos: THREE.BufferGeometry[] };
  const pieces: (Piece | undefined)[] = [];
  const dropPiece = (p: Piece | undefined) => p?.geos.forEach((g) => g.dispose());
  const shapeFor = (i: number, label: string | undefined, size: Vec3): THREE.Object3D | null => {
    const id = `shape|${label}|${size.join(",")}`;
    if (pieces[i]?.id === id) return pieces[i]!.obj;
    const geos: THREE.BufferGeometry[] = [];
    const obj = pieceShape(label, size, mat, (g) => (geos.push(g), g));
    dropPiece(pieces[i]);
    pieces[i] = obj ? { id, obj, geos } : undefined;
    return obj;
  };
  const dropFigure = (f: { obj: THREE.Object3D; man?: Mannequin }) => {
    scene.remove(f.obj);
    f.man?.dispose();
  };

  let last: { path: CameraPath; picked: number | null } | null = null;
  const sync = (path: CameraPath, picked: number | null = null) => {
    if (!dirty && last && last.path.props === path.props && last.path.actors === path.actors && last.picked === picked) return;
    dirty = false;
    last = { path, picked };
    for (const g of temp) g.dispose();
    temp = [];
    sets.clear();

    // Set pieces: the 3D take placed in its box once loaded, else the shape its name says (a table,
    // a car…), else the box the ghost rig draws.
    (path.props ?? []).forEach((p, i) => {
      const holder = new THREE.Group();
      holder.position.set(p.at[0], 0, p.at[1]);
      holder.rotation.y = ((p.rot ?? 0) * Math.PI) / 180;
      const fitted = p.model ? modelFor(p.model, p.size) : null;
      if (fitted && pieces[i]?.id !== fitted.id) {
        dropPiece(pieces[i]);
        pieces[i] = { id: fitted.id, obj: copyModel(fitted.model), geos: [] };
      }
      const model = fitted ? pieces[i]!.obj : p.model ? null : shapeFor(i, p.label, p.size);
      if (model) holder.add(model);
      else {
        const box = new THREE.Mesh(tmp(new THREE.BoxGeometry(...p.size)), mat.box);
        box.position.y = p.size[1] / 2;
        holder.add(box);
      }
      if (!model || picked === i) {
        const edges = new THREE.LineSegments(tmp(new THREE.EdgesGeometry(tmp(new THREE.BoxGeometry(...p.size)))), picked === i ? mat.picked : mat.boxEdge);
        edges.position.y = p.size[1] / 2;
        // A shape's outline is only for picking it out in the plan, never in the lens.
        if (model) edges.layers.set(gizmo);
        holder.add(edges);
      }
      sets.add(holder);
    });
    while (pieces.length > (path.props?.length ?? 0)) dropPiece(pieces.pop());

    // A figure per stand-in; rebuilt only when it changes body.
    const actors = castOf(path);
    while (figures.length > actors.length) dropFigure(figures.pop()!);
    actors.forEach((a, i) => {
      // A 3D take scaled to the stand-in's height; a block figure until it loads (or if it can't).
      const fitted = a.model ? modelFor(a.model, [50, a.height, 50]) : null;
      const id = fitted ? fitted.id : `man|${i}`;
      if (figures[i]?.id === id) return;
      if (figures[i]) dropFigure(figures[i]);
      if (fitted) figures[i] = { id, obj: copyModel(fitted.model) };
      else {
        const man = mannequin(ACTOR_COLORS[i % ACTOR_COLORS.length]);
        figures[i] = { id, obj: man.group, man };
      }
      scene.add(figures[i].obj);
    });
  };

  const place = (shot: CameraPath, frame: number) => {
    const path = shot.actors ? shot : { ...shot, actors: DEFAULT_CAST };
    const now = actorPositions(path, frame);
    const before = actorPositions(path, Math.max(0, frame - 1));
    const cam0 = path.keys[0].pos;
    castOf(path).forEach((a, i) => {
      const f = figures[i];
      if (!f) return;
      const [x, , z] = now[i];
      const walking = walks(a);
      f.obj.position.set(x, 0, z);
      f.obj.rotation.y = walking ? Math.atan2(a.to[0] - a.from[0], a.to[1] - a.from[1]) : (facingOf(a, cam0) * Math.PI) / 180;
      if (f.man) {
        f.man.group.scale.setScalar(a.height / 1.75);
        // A walker's motion is its pace (walking by default); one on the spot stands unless told otherwise.
        const motion = walking ? (a.action && a.action in STRIDE ? a.action : "walk") : a.action && !(a.action in STRIDE) ? a.action : "idle";
        const walked = Math.hypot(x - a.from[0], z - a.from[1]);
        const speed = Math.hypot(x - before[i][0], z - before[i][2]) * path.fps;
        f.man.pose(motion, frame / path.fps, (walked / (STRIDE[motion] ?? 1.3)) * Math.PI * 2, Math.min(1, speed / 0.6));
      }
    });
  };

  const ready = async () => {
    while (pending.size) await Promise.allSettled([...pending]);
  };

  return {
    sync,
    place,
    ready,
    loading: () => pending.size > 0,
    dispose: () => {
      for (const f of figures) dropFigure(f);
      pieces.forEach(dropPiece);
      for (const g of temp) g.dispose();
      for (const x of owned) x.dispose();
      env.dispose();
      pmrem.dispose();
    },
  };
}

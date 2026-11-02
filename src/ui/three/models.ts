// 3D files as three.js objects, whichever of the common formats a workflow saved. The take viewer
// opens its own copy; the 3D plan loads each file once and places copies of it, so a take used as
// three set pieces is read once. Only imported dynamically, to keep three.js out of the first load.

import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { isAppFile, type Vec3 } from "@/lib/cinema/camera";
import { tr } from "@/i18n";

/** The model as a three.js object. A fresh load each call: the caller owns (and disposes) it. */
export async function loadModel(url: string): Promise<THREE.Object3D> {
  const ext = (/\.(\w+)(?:\?|$)/.exec(url)?.[1] ?? "").toLowerCase();
  const plain = () => new THREE.MeshStandardMaterial({ color: 0xc9c3b8, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  if (ext === "glb" || ext === "gltf") {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    return (await new GLTFLoader().loadAsync(url)).scene;
  }
  if (ext === "obj") {
    const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
    const obj = await new OBJLoader().loadAsync(url);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        if (!m.geometry.attributes.normal) m.geometry.computeVertexNormals();
        m.material = plain();
      }
    });
    return obj;
  }
  if (ext === "fbx") {
    const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
    return new FBXLoader().loadAsync(url);
  }
  if (ext === "stl" || ext === "ply") {
    const geometry =
      ext === "stl"
        ? await new (await import("three/addons/loaders/STLLoader.js")).STLLoader().loadAsync(url)
        : await new (await import("three/addons/loaders/PLYLoader.js")).PLYLoader().loadAsync(url);
    const colored = !!geometry.attributes.color;
    // A PLY without faces is a point cloud.
    if (ext === "ply" && !geometry.index) {
      return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: colored, color: colored ? 0xffffff : 0xc9c3b8 }));
    }
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const material = plain();
    if (colored) {
      material.vertexColors = true;
      material.color.set(0xffffff);
    }
    return new THREE.Mesh(geometry, material);
  }
  throw new Error(tr("This 3D file couldn't be opened here. Download it to open it in a 3D app."));
}

// One load per file for the session; copies share its geometry and materials, so never dispose them.
const loaded = new Map<string, Promise<THREE.Object3D>>();

function shared(url: string): Promise<THREE.Object3D> {
  if (!isAppFile(url)) return Promise.reject(new Error(tr("This 3D file couldn't be opened here. Download it to open it in a 3D app.")));
  let p = loaded.get(url);
  if (!p) {
    p = loadModel(url);
    // A failed load can be tried again later (the file may not have finished downloading).
    p.catch(() => loaded.delete(url));
    loaded.set(url, p);
  }
  return p;
}

/** A copy that shares geometry and materials; a rigged model keeps its skeleton working. */
export const copyModel = (o: THREE.Object3D) => clone(o);

/** How big the model is, [x, y, z] in its own units. */
export async function modelExtent(url: string): Promise<Vec3> {
  const size = new THREE.Box3().setFromObject(await shared(url)).getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}

/**
 * A copy of the model fitted into a box [width, height, depth]: scaled as one to fit inside it,
 * centred on it and standing on the floor. Place the returned group at the box's spot.
 */
export async function fittedModel(url: string, box: Vec3): Promise<THREE.Group> {
  const copy = copyModel(await shared(url));
  const bounds = new THREE.Box3().setFromObject(copy);
  const size = bounds.getSize(new THREE.Vector3());
  const k = Math.min(box[0] / Math.max(size.x, 1e-6), box[1] / Math.max(size.y, 1e-6), box[2] / Math.max(size.z, 1e-6));
  const center = bounds.getCenter(new THREE.Vector3());
  // Scale about the world origin (the copy's own offset scales too), then centre it on the box.
  copy.scale.multiplyScalar(k);
  copy.position.multiplyScalar(k).add(new THREE.Vector3(-center.x * k, -bounds.min.y * k, -center.z * k));
  const group = new THREE.Group();
  group.add(copy);
  return group;
}

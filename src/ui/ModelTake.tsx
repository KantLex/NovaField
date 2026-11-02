"use client";

// A 3D take on screen: the model a workflow saved, lit like a product shot, turning slowly until
// it's dragged. Any view can be sent on as a picture (a first frame, a cast member…), and the first
// view becomes the take's poster when the workflow saved no picture of its own. Keyed by take, so
// another take opens a fresh viewer.

import { Box, ImageDown, LoaderCircle, RotateCcw, RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Job } from "@/lib/jobs";
import { api, fail, request } from "./api";
import { Menu, MenuItem } from "./Menu";
import { PICTURE_TARGETS, sendPicture, type PictureTarget } from "./sendTo";
import { tr } from "@/i18n";

interface Viewer {
  /** The current view as a picture. */
  snapshot: (type: "image/png" | "image/jpeg", width?: number) => Promise<Blob>;
  reset: () => void;
  spin: (on: boolean) => void;
  dispose: () => void;
}

// Posters already sent this session, so reopening a take doesn't send another.
const postered = new Set<string>();

export function ModelTake({ job }: { job: Job }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [spinning, setSpinning] = useState(true);
  const [sending, setSending] = useState(false);
  const router = useRouter();
  const url = job.model!;

  useEffect(() => {
    let alive = true;
    open(host.current!, url, () => alive && setSpinning(false))
      .then((v) => {
        if (!alive) return v.dispose();
        viewer.current = v;
        setState("ready");
        if (!job.poster && !postered.has(job.id)) {
          postered.add(job.id);
          void v
            .snapshot("image/jpeg", 640)
            .then((blob) => request(`/api/jobs/${job.id}/poster`, { method: "PUT", body: blob }))
            .catch(() => postered.delete(job.id));
        }
      })
      .catch(() => alive && setState("failed"));
    return () => {
      alive = false;
      viewer.current?.dispose();
      viewer.current = null;
    };
    // The poster check reads the take once, when its model opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, job.id]);

  const send = async (to: PictureTarget) => {
    const v = viewer.current;
    if (!v) return;
    setSending(true);
    try {
      const blob = await v.snapshot("image/png");
      const asset = await api.upload(new File([blob], `${job.id}-view.png`, { type: "image/png" }), "image");
      sendPicture({ ...asset, label: job.title }, to, (href) => router.push(href));
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,#262421,#090909_70%)]">
      <div ref={host} className="absolute inset-0 cursor-grab active:cursor-grabbing" aria-label={tr("3D model: drag to turn it, scroll to zoom")} />
      {state === "loading" && (
        <p className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-dim">
          <LoaderCircle size={15} className="animate-spin" /> {tr("Opening the 3D model…")}
        </p>
      )}
      {state === "failed" && (
        <p className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-[13px] text-dim">
          <Box size={22} className="text-faint" />
          {tr("This 3D file couldn't be opened here. Download it to open it in a 3D app.")}
        </p>
      )}
      {state === "ready" && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 text-[12px] text-ink">
          <button
            onClick={() => {
              viewer.current?.spin(!spinning);
              setSpinning(!spinning);
            }}
            className="flex items-center gap-1"
            aria-pressed={spinning}
          >
            <RotateCw size={15} className={spinning ? "text-tungsten" : undefined} />
            {tr("Turntable")}
          </button>
          <button onClick={() => viewer.current?.reset()} className="flex items-center gap-1">
            <RotateCcw size={15} />
            {tr("Reset view")}
          </button>
          <span className="flex-1" />
          <span className="hidden text-faint sm:inline">{tr("Drag to turn, scroll to zoom")}</span>
          <Menu
            label={tr("Use this view")}
            align="right"
            trigger={() => (
              <span className="flex items-center gap-1">
                {sending ? <LoaderCircle size={15} className="animate-spin" /> : <ImageDown size={16} />}
                <span className="hidden sm:inline">{tr("Use this view")}</span>
              </span>
            )}
          >
            {(close) =>
              PICTURE_TARGETS.map((t) => (
                <MenuItem
                  key={t.id}
                  onClick={() => {
                    close();
                    void send(t.id);
                  }}
                >
                  {tr(t.label)}
                </MenuItem>
              ))
            }
          </Menu>
        </div>
      )}
    </div>
  );
}

/** Load three.js and the model, frame it, and start drawing. */
async function open(el: HTMLElement, url: string, onGrab: () => void): Promise<Viewer> {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
  const { loadModel } = await import("./three/models");
  const object = await loadModel(url);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  el.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key, new THREE.HemisphereLight(0xdfe8ff, 0x1a1612, 0.6));

  // Centred on the origin, sitting on the floor, about two units across.
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = 2 / Math.max(size.x, size.y, size.z, 1e-6);
  object.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  object.position.set(-center.x, -box.min.y * scale, -center.z);
  scene.add(object);
  const height = size.y * scale;
  const floor = new THREE.GridHelper(6, 24, 0x3a3631, 0x24211e);
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const target = new THREE.Vector3(0, height / 2, 0);
  const home = () => {
    camera.position.set(2.6, height / 2 + 1.1, 3.4);
    controls.target.copy(target);
    controls.update();
  };
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = 0.5;
  controls.maxDistance = 20;
  controls.addEventListener("start", () => {
    if (!controls.autoRotate) return;
    controls.autoRotate = false;
    onGrab();
  });
  home();

  const fit = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  fit();
  const resize = new ResizeObserver(fit);
  resize.observe(el);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    snapshot: (type, width) =>
      new Promise((resolve, reject) => {
        // A clean frame without the floor grid, at the canvas size or scaled to `width`.
        floor.visible = false;
        renderer.render(scene, camera);
        const src = renderer.domElement;
        const out = document.createElement("canvas");
        const k = width ? width / src.width : 1;
        out.width = Math.round(src.width * k);
        out.height = Math.round(src.height * k);
        const ctx = out.getContext("2d")!;
        if (type === "image/jpeg") {
          ctx.fillStyle = "#121110";
          ctx.fillRect(0, 0, out.width, out.height);
        }
        ctx.drawImage(src, 0, 0, out.width, out.height);
        floor.visible = true;
        out.toBlob((b) => (b ? resolve(b) : reject(new Error(tr("Couldn't capture the view.")))), type, 0.88);
      }),
    reset: home,
    spin: (on) => {
      controls.autoRotate = on;
    },
    dispose: () => {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as import("three").Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      // Hand the context back now: browsers hold only a few, and drop the oldest past that.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

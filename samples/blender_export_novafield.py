"""Export the scene camera's animation from Blender as a NovaField camera path (.json).

Run it in Blender (Scripting workspace → open this file → Run Script) with an animated scene
camera. It writes "<blend name>-camera.json" next to the .blend file (or in your home folder if
the file isn't saved). Drop that into NovaField: Studio → Camera move → Import .json.

Coordinates: Blender is Z up; NovaField is Y up, in metres, with the subject near the origin.
The export maps (x, y, z) → (x, z, -y). Optional objects, matched by name:
- "Subject": its floor position on the first frame becomes the origin (otherwise the world origin).
- "Actor", "Actor.001"… (up to 3): stand-ins, walking from where they are on the first frame
  to where they are on the last.
- "Prop…" meshes (up to 8): set pieces, from their size and turn.
"""

import json
import math
import os

import bpy
from mathutils import Vector

MAX_KEYS = 120  # longer shots are sampled every few frames
TARGET_DISTANCE = 5.0  # metres in front of the lens; only the direction matters

scene = bpy.context.scene
cam = scene.camera
if cam is None or cam.type != "CAMERA":
    raise RuntimeError("Set an active scene camera first (Scene properties → Camera).")

start, end = scene.frame_start, scene.frame_end
frames = end - start + 1
fps = scene.render.fps / scene.render.fps_base
step = max(1, math.ceil(frames / MAX_KEYS))
samples = list(range(start, end + 1, step))
if samples[-1] != end:
    samples.append(end)

origin = Vector((0.0, 0.0, 0.0))
subject = bpy.data.objects.get("Subject")
if subject is not None:
    scene.frame_set(start)
    p = subject.matrix_world.translation
    origin = Vector((p.x, p.y, 0.0))


def to_nf(v):
    """Blender (Z up) → NovaField (Y up)."""
    return Vector((v.x, v.z, -v.y))


def floor(v):
    """A Blender world point → NovaField floor position [x, z]."""
    d = v - origin
    return [round(d.x, 4), round(-d.y, 4)]


def vertical_fov(data):
    if data.type != "PERSP":
        return 40.0
    r = scene.render
    aspect = (r.resolution_x * r.pixel_aspect_x) / (r.resolution_y * r.pixel_aspect_y)
    fit = data.sensor_fit
    horizontal = aspect >= 1 if fit == "AUTO" else fit == "HORIZONTAL"
    sensor = data.sensor_height if fit == "VERTICAL" else data.sensor_width
    half = math.atan(sensor / (2 * data.lens))
    if horizontal:
        return math.degrees(2 * math.atan(math.tan(half) / aspect))
    return math.degrees(2 * half)


keys = []
up = Vector((0.0, 1.0, 0.0))
for f in samples:
    scene.frame_set(f)
    m = cam.matrix_world
    rot = m.to_3x3()
    pos = to_nf(m.translation - origin)
    forward = to_nf(rot @ Vector((0.0, 0.0, -1.0))).normalized()  # cameras look down their -Z
    right = to_nf(rot @ Vector((1.0, 0.0, 0.0))).normalized()
    # Roll, as NovaField computes the camera's frame (docs/contract.md §1, steps 7–8).
    r = forward.cross(up)
    r = Vector((1.0, 0.0, 0.0)) if r.length < 1e-6 else r.normalized()
    u = r.cross(forward)
    roll = math.degrees(math.atan2(right.dot(u), right.dot(r)))
    target = pos + forward * TARGET_DISTANCE
    keys.append(
        {
            "t": round((f - start) / max(1, frames - 1), 5),
            "pos": [round(c, 4) for c in pos],
            "target": [round(c, 4) for c in target],
            "fov": round(vertical_fov(cam.data), 3),
            "roll": round(roll, 3),
        }
    )

actors = []
for obj in sorted((o for o in scene.objects if o.name.startswith("Actor")), key=lambda o: o.name)[:3]:
    scene.frame_set(start)
    a = obj.matrix_world.translation.copy()
    scene.frame_set(end)
    b = obj.matrix_world.translation.copy()
    height = obj.dimensions.z if obj.type == "MESH" and obj.dimensions.z > 0 else 1.75
    actors.append({"from": floor(a), "to": floor(b), "height": round(min(3.0, max(0.3, height)), 3)})

props = []
scene.frame_set(start)
for obj in sorted((o for o in scene.objects if o.name.startswith("Prop") and o.type == "MESH"), key=lambda o: o.name)[:8]:
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    centre = sum(corners, Vector()) / 8
    d = obj.dimensions
    props.append(
        {
            "at": floor(centre),
            "size": [round(max(0.05, d.x), 3), round(max(0.05, d.z), 3), round(max(0.05, d.y), 3)],
            "rot": round(math.degrees(obj.matrix_world.to_euler("XYZ").z), 2),
            "label": obj.name,
        }
    )

name = bpy.path.display_name_from_filepath(bpy.data.filepath) or "Blender camera"
doc = {
    "format": "novafield-camera-path",
    "name": f"{name}: {cam.name}",
    "version": 1,
    "frames": frames,
    "fps": round(fps, 3),
    "ease": "linear",  # the keys already carry the timing, frame by frame
    "keys": keys,
}
if actors:
    doc["actors"] = actors
if props:
    doc["props"] = props

folder = bpy.path.abspath("//") if bpy.data.filepath else os.path.expanduser("~")
out = os.path.join(folder, f"{name.replace(' ', '-')}-camera.json")
with open(out, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
print(f"NovaField camera path: {len(keys)} keys over {frames} frames → {out}")

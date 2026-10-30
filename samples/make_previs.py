"""A grey-box previs, like a quick Blender blockout: a figure walks down a street while the camera
starts wide and low, arcs round and pushes in to a medium close-up. Flat-shaded boxes, painter's
algorithm, 2x supersampled. Writes raw RGB frames to stdout for ffmpeg:

    uv run --no-project --with pillow --with numpy python samples/make_previs.py \
      | ffmpeg -f rawvideo -pix_fmt rgb24 -s 864x480 -r 24 -i - \
          -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart samples/previs-street-walk.mp4

Drop the result into Studio → Camera move → Your own previs."""

import math
import sys

import numpy as np
from PIL import Image, ImageDraw

W, H, SS = 864, 480, 2
FPS, SECONDS = 24, 6
FRAMES = FPS * SECONDS
FOV = math.radians(48)  # vertical
LIGHT = np.array([0.45, 0.8, 0.35])
LIGHT /= np.linalg.norm(LIGHT)
SKY_TOP, SKY_BOTTOM = np.array([120, 128, 138]), np.array([182, 186, 190])


def box(cx, cy, cz, sx, sy, sz, color, rot=0.0):
    """Six quads of an axis box (centre, size), turned `rot` radians about its vertical axis."""
    x, y, z = sx / 2, sy / 2, sz / 2
    corners = np.array([[a, b, c] for a in (-x, x) for b in (-y, y) for c in (-z, z)], float)
    c, s = math.cos(rot), math.sin(rot)
    corners = corners @ np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]]).T + [cx, cy, cz]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return [(corners[list(f)], color) for f in faces]


def limb(top, length, width, angle, color, depth=None):
    """A box hanging from `top`, swung `angle` radians forward (about x)."""
    d = depth or width
    out = []
    for quad, col in box(0, -length / 2, 0, width, length, d, color):
        c, s = math.cos(angle), math.sin(angle)
        q = quad @ np.array([[1, 0, 0], [0, c, -s], [0, s, c]]).T + top
        out.append((q, col))
    return out


# The set: a street running along z, buildings either side, crates and lamp posts.
# Ground and road are drawn first, then a 1 m grid on them (it shows the camera's motion), then the rest.
GROUND = [
    (np.array([[-15, 0, 14], [15, 0, 14], [15, 0, -26], [-15, 0, -26]], float), (150, 150, 152)),
    (np.array([[-1.6, 0.005, 14], [1.6, 0.005, 14], [1.6, 0.005, -26], [-1.6, 0.005, -26]], float), (118, 118, 122)),
]
GRID = [((x, 0.01, 14), (x, 0.01, -26)) for x in range(-15, 16)] + [((-15, 0.01, z), (15, 0.01, z)) for z in range(-26, 15)]
STATIC = []
for i, z in enumerate(range(6, -26, -5)):
    h = 3.5 + (i * 1.7) % 3.2
    STATIC += box(-5.2, h / 2, z, 3.6, h, 4.2, (168, 168, 172))
    h2 = 4.2 + (i * 2.3) % 2.8
    STATIC += box(5.4, h2 / 2, z - 1.5, 3.8, h2, 4.4, (160, 160, 165))
for z in (3.5, -1.5, -6.5, -11.5):
    STATIC += box(-2.3, 1.6, z, 0.12, 3.2, 0.12, (90, 92, 96))  # lamp posts
    STATIC += box(-2.0, 3.2, z, 0.7, 0.1, 0.18, (90, 92, 96))
STATIC += box(2.1, 0.35, 0.6, 0.7, 0.7, 0.7, (140, 132, 120), 0.3)  # crates
STATIC += box(2.6, 0.3, -0.2, 0.6, 0.6, 0.6, (132, 126, 116), -0.2)
STATIC += box(2.3, 0.95, 0.4, 0.5, 0.5, 0.5, (146, 138, 126), 0.6)


def figure(t):
    """The subject: walks toward camera along -z at 1.2 m/s, arms and legs swinging."""
    z = 4.0 - 1.2 * t
    phase = t * 2 * math.pi * 1.7
    swing = 0.55 * math.sin(phase)
    bob = 0.04 * abs(math.sin(phase))
    col, dark = (210, 120, 60), (170, 92, 44)
    hip = np.array([0.0, 0.95 + bob, z])
    parts = []
    parts += box(0, 1.32 + bob, z, 0.42, 0.62, 0.24, col)  # torso
    parts += box(0, 1.8 + bob, z, 0.24, 0.26, 0.24, col)  # head
    parts += limb(hip + [-0.11, 0, 0], 0.9, 0.16, swing, dark)
    parts += limb(hip + [0.11, 0, 0], 0.9, 0.16, -swing, dark)
    parts += limb(hip + [-0.3, 0.6, 0], 0.62, 0.12, -swing * 0.8, col)
    parts += limb(hip + [0.3, 0.6, 0], 0.62, 0.12, swing * 0.8, col)
    return parts, np.array([0.0, 1.45 + bob, z])


def ease(u):
    return u * u * (3 - 2 * u)


def camera(t, subject):
    """Wide and low on the right, arcing round to the subject's left and pushing in."""
    u = ease(min(1.0, t / SECONDS))
    # The subject walks toward -z, so "in front" is further along -z. Angle 0 = straight ahead.
    angle = math.radians(38 - 96 * u)
    dist = 7.5 - 4.7 * u
    height = 0.55 + 1.0 * u
    pos = np.array([subject[0] + dist * math.sin(angle), height, subject[2] - dist * math.cos(angle)])
    target = subject + [0, -0.15 * (1 - u), 0]
    return pos, target


def look(pos, target):
    f = target - pos
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0])
    r /= np.linalg.norm(r)
    up = np.cross(r, f)
    return np.stack([r, up, -f])  # rows: camera x, y, z (camera looks down -z)


NEAR = 0.05


def clip_near(cam_pts):
    """Clip a polygon in camera space against z = -NEAR (Sutherland-Hodgman)."""
    out = []
    n = len(cam_pts)
    for i in range(n):
        a, b = cam_pts[i], cam_pts[(i + 1) % n]
        ina, inb = a[2] < -NEAR, b[2] < -NEAR
        if ina:
            out.append(a)
        if ina != inb:
            k = (-NEAR - a[2]) / (b[2] - a[2])
            out.append(a + (b - a) * k)
    return out


def render(t):
    parts, subject = figure(t)
    pos, target = camera(t, subject)
    rot = look(pos, target)
    focal = (H * SS / 2) / math.tan(FOV / 2)
    img = Image.new("RGB", (W * SS, H * SS))
    draw = ImageDraw.Draw(img)
    for y in range(H * SS):  # sky gradient
        k = y / (H * SS)
        c = tuple(int(v) for v in SKY_TOP * (1 - k) + SKY_BOTTOM * k)
        draw.line([(0, y), (W * SS, y)], fill=c)

    def project(p):
        return (W * SS / 2 + focal * p[0] / -p[2], H * SS / 2 - focal * p[1] / -p[2])

    def fogged(color, depth):
        fog = min(1.0, max(0.0, (depth - 8) / 30))
        return tuple(int(v) for v in np.array(color) * (1 - fog) + SKY_BOTTOM * fog)

    for quad, color in GROUND:
        cam = clip_near(list((quad - pos) @ rot.T))
        if len(cam) >= 3:
            draw.polygon([project(p) for p in cam], fill=fogged(np.array(color) * 0.93, 10))
    for a, b in GRID:
        a, b = (np.array(a, float) - pos) @ rot.T, (np.array(b, float) - pos) @ rot.T
        if a[2] > -NEAR and b[2] > -NEAR:
            continue
        if a[2] > -NEAR:
            a = a + (b - a) * ((-NEAR - a[2]) / (b[2] - a[2]))
        if b[2] > -NEAR:
            b = b + (a - b) * ((-NEAR - b[2]) / (a[2] - b[2]))
        draw.line([project(a), project(b)], fill=fogged((126, 126, 130), 14), width=SS)

    polys = []
    for quad, color in STATIC + parts:
        normal = np.cross(quad[1] - quad[0], quad[2] - quad[0])
        nl = np.linalg.norm(normal)
        if nl < 1e-9:
            continue
        normal /= nl
        centre = quad.mean(axis=0)
        if np.dot(normal, pos - centre) <= 0:
            continue  # facing away
        cam = (quad - pos) @ rot.T
        cam = clip_near(list(cam))
        if len(cam) < 3:
            continue
        pts = [project(p) for p in cam]
        shade = 0.42 + 0.58 * max(0.0, float(np.dot(normal, LIGHT)))
        depth = float(np.linalg.norm(centre - pos))
        polys.append((depth, pts, fogged(np.array(color) * shade, depth)))
    for _, pts, rgb in sorted(polys, key=lambda p: -p[0]):
        draw.polygon(pts, fill=rgb, outline=tuple(max(0, v - 18) for v in rgb))
    return img.resize((W, H), Image.LANCZOS)


for f in range(FRAMES):
    sys.stdout.buffer.write(render(f / FPS).tobytes())

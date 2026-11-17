"""Ark-1 concept CAD: binary STL meshes built from ark.json (chosen + mechanical_design), for Gazebo and Blender.

    python mechanical/cad.py   # writes mechanical/cad/*.stl

Frame: x forward, y left, z up, metres, origin at the hull bottom centre. Every part is a closed mesh.
"""

import json
import math
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARK_JSON = HERE.parent / "ark.json"
OUT = HERE / "cad"

Mesh = tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]


def ellipsoid(a: float, b: float, c: float, centre, nu: int = 48, nv: int = 24) -> Mesh:
    cx, cy, cz = centre
    verts = [(cx, cy, cz - c)]  # bottom pole
    for j in range(1, nv):
        phi = -math.pi / 2 + math.pi * j / nv
        for i in range(nu):
            th = 2 * math.pi * i / nu
            verts.append(
                (cx + a * math.cos(phi) * math.cos(th), cy + b * math.cos(phi) * math.sin(th), cz + c * math.sin(phi))
            )
    verts.append((cx, cy, cz + c))  # top pole
    top = len(verts) - 1
    ring = lambda j, i: 1 + (j - 1) * nu + i % nu
    faces = [(0, ring(1, i + 1), ring(1, i)) for i in range(nu)]
    for j in range(1, nv - 1):
        for i in range(nu):
            faces += [
                (ring(j, i), ring(j, i + 1), ring(j + 1, i + 1)),
                (ring(j, i), ring(j + 1, i + 1), ring(j + 1, i)),
            ]
    faces += [(top, ring(nv - 1, i), ring(nv - 1, i + 1)) for i in range(nu)]
    return verts, faces


def cylinder(p0, p1, r: float, n: int = 24) -> Mesh:
    ax = [p1[k] - p0[k] for k in range(3)]
    length = math.sqrt(sum(v * v for v in ax))
    w = [v / length for v in ax]
    t = (1.0, 0.0, 0.0) if abs(w[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = [w[1] * t[2] - w[2] * t[1], w[2] * t[0] - w[0] * t[2], w[0] * t[1] - w[1] * t[0]]
    un = math.sqrt(sum(v * v for v in u))
    u = [v / un for v in u]
    v_ = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]]
    verts = []
    for p in (p0, p1):
        for i in range(n):
            th = 2 * math.pi * i / n
            verts.append(tuple(p[k] + r * (math.cos(th) * u[k] + math.sin(th) * v_[k]) for k in range(3)))
    verts += [tuple(p0), tuple(p1)]
    c0, c1 = 2 * n, 2 * n + 1
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n + j), (i, n + j, n + i), (c0, j, i), (c1, n + i, n + j)]
    return verts, faces


def box(centre, size) -> Mesh:
    (cx, cy, cz), (sx, sy, sz) = centre, size
    verts = [
        (cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)
    ]
    quads = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return verts, [f for a, b, c, d in quads for f in ((a, b, c), (a, c, d))]


def merge(meshes: list[Mesh]) -> Mesh:
    verts, faces = [], []
    for v, f in meshes:
        base = len(verts)
        verts += v
        faces += [(a + base, b + base, c + base) for a, b, c in f]
    return verts, faces


def write_stl(path: Path, mesh: Mesh) -> None:
    verts, faces = mesh
    out = bytearray(b"Ark-1 concept CAD".ljust(80, b" ") + struct.pack("<I", len(faces)))
    for a, b, c in faces:
        p, q, r = verts[a], verts[b], verts[c]
        e1, e2 = [q[k] - p[k] for k in range(3)], [r[k] - p[k] for k in range(3)]
        nx, ny, nz = e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]
        nn = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        out += struct.pack("<12fH", nx / nn, ny / nn, nz / nn, *p, *q, *r, 0)
    path.write_bytes(bytes(out))


def build(ark: dict) -> dict[str, Mesh]:
    ch, md, mech, frame = ark["chosen"], ark["mechanical_design"], ark["mechanical"], ark["frame"]
    g = ch["geometry_m"]
    a, b, c = g["hull_length"] / 2, g["hull_width"] / 2, g["hull_height"] / 2
    arm_r, tube_r = g["arm_radius"], md["arms"]["od_m"] / 2
    z_arm = ark["hull"]["layout_z_frac"]["arms"] * 2 * c  # arms bolt into the clamshell's equator flange
    prop_z = z_arm + frame["motor_pylon_m"]
    r_root = 1 / math.sqrt(0.5 / a**2 + 0.5 / b**2)
    tips = [(sx * arm_r / math.sqrt(2), sy * arm_r / math.sqrt(2)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]

    frame_parts = [ellipsoid(a + 0.015, b + 0.015, 0.006, (0, 0, z_arm))]  # flange ring where the halves bolt
    props = []
    for x, y in tips:
        root = (x * r_root / arm_r * 0.9, y * r_root / arm_r * 0.9, z_arm)  # socket starts just inside the flange
        frame_parts.append(cylinder(root, (x, y, z_arm), tube_r))
        frame_parts.append(cylinder((x, y, z_arm), (x, y, prop_z - 0.045), 0.012))  # pylon
        frame_parts.append(cylinder((x, y, prop_z - 0.045), (x, y, prop_z - 0.005), 0.045))  # motor
        props.append(cylinder((x, y, prop_z - 0.004), (x, y, prop_z), g["prop_d"] / 2, n=48))

    pod = mech["pod"]["size_m"]
    sk = mech["skids"]
    z_skid = md["packaging"]["skid_bottom_z_m"] + sk["tube_d_m"] / 2
    half_len = 0.4 * g["hull_length"]
    skids = []
    for y in (-sk["track_m"] / 2, sk["track_m"] / 2):
        skids.append(cylinder((-half_len, y, z_skid), (half_len, y, z_skid), sk["tube_d_m"] / 2))
        for x in (-0.6 * half_len, 0.6 * half_len):
            yy = max(-0.9 * b, min(0.9 * b, y))
            z_hull = c - c * math.sqrt(max(0.0, 1 - (x / a) ** 2 - (yy / b) ** 2))
            skids.append(cylinder((x, y, z_skid), (x, yy, z_hull + 0.01), 0.006))

    return {
        "hull": ellipsoid(a, b, c, (0, 0, c)),
        "frame": merge(frame_parts),
        "props": merge(props),
        "pod": box((0, 0, md["packaging"]["payload_z_m"]), pod),
        "skids": merge(skids),
        "internals": merge([box(p["centre_m"], p["size_m"]) for p in md["packaging"]["parts"]]),
    }


def main() -> int:
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    parts = build(ark)
    OUT.mkdir(exist_ok=True)
    for name, mesh in parts.items():
        write_stl(OUT / f"{name}.stl", mesh)
    write_stl(OUT / "assembly.stl", merge(list(parts.values())))
    print(f"Wrote {len(parts) + 1} STL files to {OUT.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

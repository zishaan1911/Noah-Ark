"""Export the real Ark-1 to a glTF binary for Ark Command's 3D views.

    python industrial-design/export_glb.py   # out/ark_model.npz + ark.json -> apps/operator-dashboard/public/models/ark1.glb

Same airframe as the viewer (build_viewer.py: the motor pods are widened to the real T-Motor MN801-S diameter) plus the
parts the viewer builds from data and that are visible from outside: GNSS mast and puck, radar altimeter, cargo
connector, and both stowed float packs (tray, closed lid, straps, inflator bracket, actuator, head, CO2 cylinder).
Skipped, because the viewer animates or hides them: the cargo pod (a toggle), the inflated bladder, hose, pressure
switch, relief valve and D-rings, and all internal electronics. Rounded boxes are plain boxes here.

Frame: glTF, metres, +Y up. Model x forward -> -Z, model y left -> -X, model z up -> +Y. The origin sits horizontally
between the skid feet and vertically on the lowest point of the landing gear, so y = 0 is ground contact.
The four propellers are nodes prop_1 .. prop_4, pivoted at their hub centre (spin about local Y) with extras {"dir": +-1}.
Everything else is merged per material. The GDEX, AWS and flag artwork is laid on flat quads on the hub faces.
"""

import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from build_viewer import ARK_JSON, OUT, widen_radially
from PIL import Image, ImageDraw
from trimesh.visual import TextureVisuals
from trimesh.visual.material import PBRMaterial

HERE = Path(__file__).resolve().parent
LIVERY = HERE / "livery"
DEFAULT_OUT = HERE.parents[1] / "apps" / "operator-dashboard" / "public" / "models" / "ark1.glb"
MAX_BYTES = 8_000_000

# viewer_template.html materials: (sRGB colour, roughness, metalness, clearcoat, emissive colour, double sided)
MATERIALS: dict[str, tuple[int, float, float, float, int | None, bool]] = {
    "shell": (0xF1EFE9, 0.28, 0.0, 0.8, None, False),
    "pod": (0x55595F, 0.3, 0.9, 0.0, None, False),
    "carbon": (0x121315, 0.32, 0.2, 1.0, None, True),
    "steel": (0xC4C9CD, 0.28, 1.0, 0.0, None, False),
    "anod": (0x3B3F44, 0.35, 0.85, 0.0, None, False),
    "orange": (0xE8621C, 0.42, 0.0, 0.5, None, False),
    "white": (0xF4F3EF, 0.35, 0.0, 0.5, None, False),
    "rubber": (0x18191A, 0.9, 0.0, 0.0, None, False),
    "radome": (0x1D2023, 0.75, 0.0, 0.0, None, False),
    "black": (0x141516, 0.5, 0.0, 0.0, None, False),
    "gold": (0xD4A53C, 0.3, 1.0, 0.0, None, False),
    "navG": (0x2BD45A, 0.5, 0.0, 0.0, 0x1AA83F, False),
    # 30_pontoons.js
    "cordura": (0xD9561C, 0.88, 0.0, 0.0, None, False),
    "cordDark": (0xA8400F, 0.9, 0.0, 0.0, None, False),
    "web": (0x1C1D1F, 0.95, 0.0, 0.0, None, False),
    "tan": (0xBFA274, 0.5, 0.0, 0.0, None, False),
    "cyl": (0xD8DADC, 0.22, 1.0, 0.0, None, False),
}


def make_material(key: str) -> PBRMaterial:
    color, rough, metal, clearcoat, emissive, double = MATERIALS[key]
    rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
    kw = {}
    if emissive is not None:
        kw["emissiveFactor"] = [((emissive >> s) & 255) / 255 for s in (16, 8, 0)]
    return PBRMaterial(
        name=key,
        baseColorFactor=[*rgb, 255],
        metallicFactor=metal,
        roughnessFactor=round(
            rough * (1 - 0.4 * clearcoat), 3
        ),  # glTF core has no clearcoat: a glossier base stands in
        doubleSided=double,
        **kw,
    )


def to_gltf(v: np.ndarray) -> np.ndarray:
    """Model frame (x forward, y left, z up) -> glTF (+Y up, nose -Z, left -X)."""
    return np.stack([-v[:, 1], v[:, 2], -v[:, 0]], axis=1)


def box(sx: float, sy: float, sz: float, x: float, y: float, z: float) -> trimesh.Trimesh:
    return trimesh.creation.box(extents=(sx, sy, sz), transform=trimesh.transformations.translation_matrix((x, y, z)))


def cyl_z(r: float, h: float, x: float, y: float, z: float, sections: int = 40) -> trimesh.Trimesh:
    return trimesh.creation.cylinder(
        radius=r, height=h, sections=sections, transform=trimesh.transformations.translation_matrix((x, y, z))
    )


def ray_hit(v: np.ndarray, f: np.ndarray, o: np.ndarray, d: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    """Nearest hit of a ray on a triangle mesh (Moller-Trumbore) -> (point, normal facing the ray origin)."""
    tri = v[f]
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1.0), 0.0)
    s = o - tri[:, 0]
    u = (s * p).sum(1) * inv
    q = np.cross(s, e1)
    w = (d * q).sum(1) * inv
    t = (e2 * q).sum(1) * inv
    hit = ok & (u >= 0) & (w >= 0) & (u + w <= 1) & (t > 0)
    if not hit.any():
        return None
    i = np.where(hit)[0][np.argmin(t[hit])]
    n = np.cross(e1[i], e2[i])
    n /= np.linalg.norm(n)
    return o + t[i] * d, (-n if n @ d > 0 else n)


def compose(w_mm: float, h_mm: float, logos: list[tuple[str, float, float, float]], divider: tuple | None = None):
    """Transparent artwork sheet (8 px/mm): logos = (livery file stem, x mm, y mm, height mm); None if art is missing."""
    px = 8
    img = Image.new("RGBA", (round(w_mm * px), round(h_mm * px)), (0, 0, 0, 0))
    for stem, x, y, h in logos:
        path = LIVERY / f"{stem}.png"
        if not path.exists():
            return None
        logo = Image.open(path).convert("RGBA")
        logo = logo.resize((round(h * logo.width / logo.height * px), round(h * px)), Image.LANCZOS)
        img.alpha_composite(logo, (round(x * px), round(y * px)))
    if divider:
        ImageDraw.Draw(img).rectangle([round(c * px) for c in divider], fill=(29, 34, 38, 90))
    return img


def logo_w(stem: str, h: float) -> float:
    path = LIVERY / f"{stem}.png"
    if not path.exists():
        return 0.0
    with Image.open(path) as im:
        return h * im.width / im.height


def decal_quad(centre, normal, up, w: float, h: float, img: Image.Image) -> trimesh.Trimesh:
    """Flat textured quad on a hub face, 0.5 mm off the shell (10_decals.js: T = up x N, B = N x T), model frame."""
    t = np.cross(up, normal)
    t /= np.linalg.norm(t)
    b = np.cross(normal, t)
    c = np.asarray(centre) + 0.0005 * np.asarray(normal)
    corners = np.array(
        [c - t * w / 2 - b * h / 2, c + t * w / 2 - b * h / 2, c + t * w / 2 + b * h / 2, c - t * w / 2 + b * h / 2]
    )
    uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=float)  # trimesh flips v on export: image upright
    mat = PBRMaterial(name="decal", baseColorTexture=img, metallicFactor=0.0, roughnessFactor=0.2, alphaMode="BLEND")
    m = trimesh.Trimesh(to_gltf(corners), [[0, 1, 2], [0, 2, 3]], process=False)
    m.visual = TextureVisuals(uv=uv, material=mat)
    return m


def addon_parts(ark: dict) -> list[tuple[str, trimesh.Trimesh]]:
    """(material key, mesh) in the model frame, from 15_mounts.js and 30_pontoons.js."""
    res = ark["industrial_design"]["result"]
    mounts, pont = res["mounts"], res["pontoons"]
    top, under, radar, zb = (
        mounts["hub_top_z_m"],
        mounts["hub_bottom_z_m"],
        mounts["radar_z_m"],
        mounts["skid_bottom_z_m"],
    )
    out: list[tuple[str, trimesh.Trimesh]] = [
        ("carbon", cyl_z(0.005, 0.07, -0.06, 0, top + 0.03)),
        ("white", cyl_z(0.025, 0.012, -0.06, 0, top + 0.07, 48)),
        ("black", cyl_z(0.021, 0.004, -0.06, 0, top + 0.077, 48)),
        ("radome", box(0.079, 0.108, 0.02, -0.11, 0, radar - 0.012)),
        ("anod", cyl_z(0.03, 0.014, 0.04, 0, under - 0.007, 48)),
        ("orange", cyl_z(0.032, 0.004, 0.04, 0, under - 0.016, 48)),
        ("black", cyl_z(0.022, 0.012, 0.04, 0, under - 0.022)),
        ("steel", box(0.008, 0.02, 0.012, 0.04, 0, under - 0.033)),
    ]
    for k in range(4):
        a = k * np.pi / 2 + np.pi / 4
        out.append(("gold", cyl_z(0.0018, 0.006, 0.04 + np.cos(a) * 0.012, np.sin(a) * 0.012, under - 0.029, 10)))

    yo = pont["skid_y_m"]
    x0, x1, y_in, wd, z0, ht = -0.18, 0.18, yo + 0.0015, 0.047, zb + 0.002, 0.05
    length, pcy, pcz = x1 - x0, y_in + wd / 2, z0 + ht / 2
    inf_y, inf_z = yo - 0.03, zb + 0.045
    for s in (1, -1):
        out += [
            ("cordura", box(length, wd, 0.003, 0, s * pcy, z0 + 0.0015)),  # tray bottom
            ("cordura", box(length, 0.003, ht, 0, s * (y_in + 0.0015), pcz)),  # tray inboard wall
            # lid, closed: top, outboard wall, two end caps, hook strip (hinge at the top-inboard edge)
            ("cordura", box(length, wd, 0.003, 0, s * (y_in + wd / 2), z0 + ht + 0.0015)),
            ("cordura", box(length, 0.003, ht, 0, s * (y_in + wd - 0.0015), z0 + ht / 2 + 0.003)),
            ("cordDark", box(length - 0.01, 0.0045, 0.009, 0, s * (y_in + wd + 0.0005), z0 + 0.009)),
        ]
        out += [
            ("cordura", box(0.003, wd, ht, e * (length - 0.003) / 2, s * (y_in + wd / 2), z0 + ht / 2 + 0.003))
            for e in (-1, 1)
        ]
        for x in (-0.075, 0.0, 0.075):  # straps clear of the skid feet, buckle at the tray's outboard corner
            out += [
                ("web", box(0.025, 0.054, 0.0018, x, s * (yo - 0.0514 + y_in) / 2, zb + 0.0505)),
                ("web", box(0.025, 0.0018, 0.053, x, s * (yo - 0.0514), (zb - 0.0015 + zb + 0.0505) / 2)),
                (
                    "web",
                    box(
                        0.025,
                        y_in + wd - (yo - 0.0514) + 0.003,
                        0.0018,
                        x,
                        s * ((yo - 0.0514) + y_in + wd + 0.003) / 2,
                        zb - 0.0015,
                    ),
                ),
                ("black", box(0.03, 0.006, 0.012, x, s * (y_in + wd + 0.004), z0 + 0.004)),
            ]
        iy = s * inf_y
        out += [
            ("anod", box(0.003, 0.036, 0.25, 0.2418, iy, -0.43)),  # inflator bracket
            ("black", box(0.03, 0.032, 0.048, 0.2595, iy, inf_z - 0.002)),  # firing actuator
            ("tan", box(0.028, 0.03, 0.03, 0.2595, iy, -0.4915)),  # inflator head
            ("cyl", cyl_z(0.016, 0.15, 0.2595, iy, -0.4765 + 0.075)),  # CO2 cylinder
            ("white", cyl_z(0.0163, 0.03, 0.2595, iy, -0.43)),
            ("cyl", cyl_z(0.0065, 0.01, 0.2595, iy, -0.4815, 20)),
        ]
    return out


def decals(body_v: np.ndarray, body_f: np.ndarray) -> list[tuple[str, trimesh.Trimesh]]:
    """The GDEX + AWS nose mark and the Malaysian flag on both hub flanks, placed as 10_decals.js does."""
    z_mid, up = -0.085, np.array([0.0, 0.0, 1.0])
    gw, aw, gap = logo_w("gdex-logo", 30), logo_w("aws-logo", 27), 22
    x0 = (230 - gw - aw - 2 * gap) / 2
    nose = compose(
        230,
        70,
        [("gdex-logo", x0, 12, 30), ("aws-logo", x0 + gw + 2 * gap, 13, 27)],
        (x0 + gw + gap - 0.4, 13, x0 + gw + gap + 0.4, 41),
    )
    flag = compose(280, 70, [("flag-of-malaysia", 12, 13, 22)])
    specs = [
        ("decal_nose", [0.45, 0, z_mid], [-1, 0, 0], 0.23, 0.07, nose),
        ("decal_flank_left", [0, 0.45, z_mid], [0, -1, 0], 0.28, 0.07, flag),
        ("decal_flank_right", [0, -0.45, z_mid], [0, 1, 0], 0.28, 0.07, flag),
    ]
    out = []
    for name, origin, direction, w, h, img in specs:
        if img is None:
            print(f"skipped {name}: livery artwork missing")
            continue
        hit = ray_hit(body_v, body_f, np.array(origin, float), np.array(direction, float))
        if hit is None:
            print(f"skipped {name}: ray missed the shell")
            continue
        out.append((name, decal_quad(hit[0], hit[1], up, w, h, img)))
    return out


def inject_extras(glb: bytes, extras: dict[str, dict]) -> bytes:
    """Write node extras into the GLB's JSON chunk (trimesh does not export per-node extras)."""
    magic, version, _ = struct.unpack_from("<4sII", glb, 0)
    jlen, jtype = struct.unpack_from("<II", glb, 12)
    doc = json.loads(glb[20 : 20 + jlen])
    seen = set()
    for node in doc["nodes"]:
        if node.get("name") in extras:
            node["extras"] = extras[node["name"]]
            seen.add(node["name"])
    if seen != set(extras):
        raise ValueError(f"nodes missing from the exported scene: {sorted(set(extras) - seen)}")
    j = json.dumps(doc, separators=(",", ":")).encode()
    j += b" " * (-len(j) % 4)
    rest = glb[20 + jlen :]
    return struct.pack("<4sII", magic, version, 20 + len(j) + len(rest)) + struct.pack("<II", len(j), jtype) + j + rest


def build_scene() -> trimesh.Scene:
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    motor_d = next(p for p in ark["candidates"]["propulsion"] if p["name"] == ark["chosen"]["propulsion"])[
        "motor_size_m"
    ][0]
    d = np.load(OUT / "ark_model.npz")
    parts: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for name in sorted({k.split("::")[0] for k in d.files}):
        v, f = d[name + "::v"].astype(np.float64), d[name + "::f"]
        parts[name] = (widen_radially(v, motor_d) if name.startswith("GEO_Base") else v, f)

    legs = [v for n, (v, _) in parts.items() if n.startswith("Legs")] or [v for v, _ in parts.values()]
    legs_v = np.concatenate(legs)
    lo, hi = legs_v.min(axis=0), legs_v.max(axis=0)
    # origin in the model frame: centre between the feet, lowest point of the gear; then the same axis swap
    origin = to_gltf(np.array([[(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]]))[0]

    def g(v: np.ndarray) -> np.ndarray:
        return to_gltf(v) - origin

    merged: dict[str, list[trimesh.Trimesh]] = {}
    scene = trimesh.Scene()
    props = []
    for name, (v, f) in parts.items():
        if name.startswith("GEO_Propeller"):
            props.append(name)
            continue
        key = (
            "pod"
            if name.startswith("GEO_Base")
            else "navG"
            if name == "Green_Light"
            else "rubber"
            if name == "Legs"
            else "shell"
        )
        merged.setdefault(key, []).append(trimesh.Trimesh(g(v), f, process=False))
    for key, mat in addon_parts(ark):
        m = mat
        m.vertices = g(np.asarray(m.vertices))
        merged.setdefault(key, []).append(m)
    for key, meshes in merged.items():
        m = trimesh.util.concatenate(meshes)
        m.visual = TextureVisuals(material=make_material(key))
        scene.add_geometry(m, node_name=key, geom_name=key)

    # propellers: pivot at the hub centre (widened hub bbox, as the viewer), spin about local Y
    carbon = make_material("carbon")
    extras = {}
    for i, name in enumerate(sorted(props), start=1):
        v, f = parts[name]
        hub = parts.get("GEO_Base" + name[-3:])
        hv = hub[0] if hub else v
        cx, cy = (hv[:, 0].min() + hv[:, 0].max()) / 2, (hv[:, 1].min() + hv[:, 1].max()) / 2
        cz = (v[:, 2].min() + v[:, 2].max()) / 2
        pivot = g(np.array([[cx, cy, cz]]))[0]
        m = trimesh.Trimesh(g(v) - pivot, f, process=False)
        m.visual = TextureVisuals(material=carbon)
        node = f"prop_{i}"
        scene.add_geometry(
            m, node_name=node, geom_name=node, transform=trimesh.transformations.translation_matrix(pivot)
        )
        extras[node] = {"dir": -1 if cx * cy > 0 else 1}
    scene.metadata["prop_extras"] = extras

    body = parts.get("GEO_Main_Body")
    if body is not None:
        for name, m in decals(*body):
            m.vertices = m.vertices - origin
            scene.add_geometry(m, node_name=name, geom_name=name)
    return scene


def triangle_count(scene: trimesh.Scene) -> int:
    return int(sum(len(m.faces) for m in scene.geometry.values()))


def export(out: Path) -> tuple[int, int]:
    """Write the GLB; returns (triangles, bytes)."""
    scene = build_scene()
    extras = scene.metadata["prop_extras"]
    data = inject_extras(scene.export(file_type="glb"), extras)
    if len(data) > MAX_BYTES and "shell" in scene.geometry:
        shell = scene.geometry["shell"]
        try:  # needs the optional fast_simplification backend; otherwise the model stays as it is
            scene.geometry["shell"] = shell.simplify_quadric_decimation(
                face_count=int(len(shell.faces) * MAX_BYTES / len(data) * 0.9)
            )
            scene.geometry["shell"].visual = TextureVisuals(material=make_material("shell"))
            data = inject_extras(scene.export(file_type="glb"), extras)
        except (AttributeError, ImportError, ValueError) as e:
            print(f"decimation unavailable ({e}); left as is")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    return triangle_count(scene), len(data)


def main() -> int:
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else DEFAULT_OUT
    tris, size = export(out)
    print(f"Wrote {out} ({tris} triangles, {size / 1e6:.2f} MB)")
    if size > MAX_BYTES:
        print(f"warning: over the {MAX_BYTES / 1e6:.0f} MB budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

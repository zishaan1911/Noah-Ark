"""Turn the drone model into Ark-1: scale, re-orient, drop the gimbal, and check what Ark adds to it.

    python industrial-design/ark_from_model.py   # drone-model/drone.npz -> out/ark_model.npz + ark.json industrial_design

- Scale so the motor centres sit on Ark's arm radius (from ark.json chosen geometry); model forward (-y) becomes +x.
- Remove the camera gimbal and its damping mount (the user's call: Ark carries cargo, not a camera).
- Structure mass from the shell surface area x a composite areal density.
- Battery: does the chosen pack (12S x P, 21700 cells upright) fit the model's rear battery slot?
- Inflatable pontoons: two tubes along the skids, stowed in flight, inflated by CO2 for a water landing; size them
  for all-up mass x (1 + reserve) and find the draft and the prop clearance above the water.
"""

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ARK_JSON = HERE.parent / "ark.json"
SRC = HERE / "drone-model" / "drone.npz"
OUT = HERE / "out"
GIMBAL = ("GEO_Camera", "GEO_Lens", "GEO_Lathe", "GEO_Support", "GEO_Computer", "GEO_Wires")


def load_parts(path: Path) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    d = np.load(path)
    names = sorted({k.split("::")[0] for k in d.files})
    return {n: (d[n + "::v"].astype(np.float64), d[n + "::f"]) for n in names}


def transform(v: np.ndarray, scale: float) -> np.ndarray:
    """Model frame (x right, y back, z up after import) -> Ark frame (x forward, y left, z up), scaled."""
    return np.stack([-v[:, 1], v[:, 0], v[:, 2]], axis=1) * scale


def area(v: np.ndarray, f: np.ndarray) -> float:
    return float(0.5 * np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum())


def surface_z(v: np.ndarray, x: float, y: float, r: float = 0.015, lowest: bool = True) -> float:
    near = v[np.hypot(v[:, 0] - x, v[:, 1] - y) < r]
    if len(near) == 0:
        raise ValueError(f"no shell vertices near ({x}, {y})")
    return float(near[:, 2].min() if lowest else near[:, 2].max())


def tube_volume(d: float, length: float) -> float:
    """Cylinder with hemispherical ends, overall length `length`."""
    return math.pi * d * d / 4 * (length - d) + math.pi * d**3 / 6


def tube_submerged(d: float, length: float, h: float) -> float:
    r = d / 2
    h = min(max(h, 0.0), d)
    seg = r * r * math.acos((r - h) / r) - (r - h) * math.sqrt(max(2 * r * h - h * h, 0.0))
    return seg * (length - d) + math.pi * h * h * (3 * r - h) / 3  # two half-sphere caps make one sphere cap


def tube_draft(d: float, length: float, volume: float) -> float:
    lo, hi = 0.0, d
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if tube_submerged(d, length, mid) < volume else (lo, mid)
    return (lo + hi) / 2


def main() -> int:
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    idc = ark["industrial_design"]
    ch = ark["chosen"]
    raw = load_parts(SRC)
    motor_c = raw["GEO_Base_01"][0].mean(axis=0)
    scale = ch["geometry_m"]["arm_radius"] / math.hypot(motor_c[0], motor_c[1])
    parts = {n: (transform(v, scale), f) for n, (v, f) in raw.items() if not n.startswith(GIMBAL)}
    removed = sorted(n for n in raw if n.startswith(GIMBAL))

    body_v, body_f = parts["GEO_Main_Body"]
    body_area = area(body_v, body_f)
    # the shell is modelled with thickness (closed mesh), so its inner and outer faces are both counted: halve it
    structure_kg = body_area / 2 * idc["shell_wall_m"] * idc["shell_density"]

    # battery: chosen pack, cells upright in the squarest grid that holds 12 x P cells
    s, p = (int(x) for x in ch["pack"].removesuffix("P").split("S"))
    cell, case = ark["mechanical"]["cell_21700_m"], ark["mechanical"]["pack_case_m"]
    n_cells = s * p
    cols = math.ceil(math.sqrt(n_cells))
    rows = math.ceil(n_cells / cols)
    pack_size = [cols * cell["d"] + 2 * case, rows * cell["d"] + 2 * case, cell["h"] + 2 * case]
    bv = parts["Battery"][0]
    slot = (bv.max(0) - bv.min(0)).tolist()
    stretch = [max(0.0, pack_size[k] - slot[k]) for k in range(3)]

    # pontoons along the skid bars
    legs = body_v[body_v[:, 2] < idc["skid_z_below_m"]]
    skid_y = float(np.abs(legs[:, 1]).max())
    skid_bottom = float(legs[:, 2].min())
    pt = idc["pontoon"]
    fixed_extra = sum(idc["added_mass_kg"].values())
    auw = ch["mass_kg"]["all_up"] - ch["mass_kg"]["hull_shell"] - ch["mass_kg"]["arms"] + structure_kg + fixed_extra
    each = tube_volume(pt["d_m"], pt["length_m"])
    draft = tube_draft(pt["d_m"], pt["length_m"], auw / 1000.0 / 2)
    tube_bottom = skid_bottom - pt["below_skid_m"]
    waterline = tube_bottom + draft
    prop_z = float(parts["GEO_Propeller_01"][0][:, 2].min())
    hub_bottom = surface_z(body_v, 0.0, 0.0)

    res = {
        "scale": round(scale, 5),
        "removed_parts": removed,
        "kept_parts": sorted(parts),
        "triangles": int(sum(len(f) for _, f in parts.values())),
        "body_area_m2": round(body_area, 4),
        "structure_kg": round(structure_kg, 3),
        "auw_estimate_kg": round(auw, 3),
        "battery": {
            "pack": ch["pack"],
            "grid": [cols, rows],
            "pack_size_m": [round(x, 4) for x in pack_size],
            "slot_size_m": [round(x, 4) for x in slot],
            "housing_stretch_m": [round(x, 4) for x in stretch],
        },
        "pontoons": {
            "volume_l_each": round(each * 1e3, 2),
            "reserve_buoyancy": round(2 * each * 1000 / auw - 1, 3),
            "draft_m": round(draft, 4),
            "waterline_z_m": round(waterline, 4),
            "prop_clearance_m": round(prop_z - waterline, 4),
            "hub_clearance_m": round(hub_bottom - waterline, 4),
            "skid_y_m": round(skid_y, 4),
            "tube_centre_z_m": round(tube_bottom + pt["d_m"] / 2, 4),
        },
        "mounts": {
            "hub_bottom_z_m": round(hub_bottom, 4),
            "hub_top_z_m": round(surface_z(body_v, 0.0, 0.0, lowest=False), 4),
            "radar_z_m": round(surface_z(body_v, -0.1, 0.0), 4),
            "skid_bottom_z_m": round(skid_bottom, 4),
        },
    }
    idc["result"] = res
    ARK_JSON.write_text(json.dumps(ark, indent=2) + "\n", encoding="utf-8")
    OUT.mkdir(exist_ok=True)
    np.savez_compressed(
        OUT / "ark_model.npz",
        **{f"{n}::v": v.astype(np.float32) for n, (v, _) in parts.items()},
        **{f"{n}::f": f for n, (_, f) in parts.items()},
    )
    print(json.dumps(res, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

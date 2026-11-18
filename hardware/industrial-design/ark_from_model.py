"""Turn the drone model into Ark-1: scale, re-orient, drop the gimbal, and check what Ark adds to it.

    python industrial-design/ark_from_model.py   # drone-model/drone.npz -> out/ark_model.npz + ark.json industrial_design

- Scale so the motor centres sit on Ark's arm radius (from ark.json chosen geometry); model forward (-y) becomes +x.
- Remove the camera gimbal and its damping mount (the user's call: Ark carries cargo, not a camera).
- Structure mass from the shell surface area x a composite areal density.
- Battery: the chosen pack (12S x P, 21700 cells upright) goes inside, in the hub's belly well; check it fits.
- Inflatable pontoons: two tubes along the skids, stowed in flight, inflated by CO2 for a water landing; size them
  for all-up mass x (1 + reserve) and find the draft and the prop clearance above the water.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant  # ARK_VARIANT picks Ark-1 or a variant folder

ARK_JSON = variant.ARK_JSON
SRC = HERE / "drone-model" / "drone.npz"
OUT = variant.OUT
# the camera gimbal and its damping mount go (Ark carries cargo); so does the external battery (the pack moves inside)
GIMBAL = ("GEO_Camera", "GEO_Lens", "GEO_Lathe", "GEO_Support", "GEO_Computer", "GEO_Wires", "Battery")


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


def belly_well(v: np.ndarray, below: float, cell: float = 0.01) -> dict:
    """Plan extent and floor of the hub's deep channel: grid cells whose lowest shell point is below `below`."""
    hub = v[(np.abs(v[:, 0]) < 0.26) & (np.abs(v[:, 1]) < 0.26) & (v[:, 2] > -0.3)]
    ix = np.floor(hub[:, 0] / cell).astype(int)
    iy = np.floor(hub[:, 1] / cell).astype(int)
    floors: dict[tuple[int, int], float] = {}
    for i, j, z in zip(ix, iy, hub[:, 2], strict=True):
        floors[(i, j)] = min(floors.get((i, j), z), z)
    deep = np.array([(i, j, z) for (i, j), z in floors.items() if z < below])
    # the channel straddles the centreline: keep the cells connected to it (|y| within the centre band)
    xs, ys = deep[:, 0] * cell, deep[:, 1] * cell
    band = np.abs(ys + cell / 2) < 0.12
    return {
        "x_m": [round(float(xs[band].min()), 3), round(float(xs[band].max() + cell), 3)],
        "y_m": [round(float(ys[band].min()), 3), round(float(ys[band].max() + cell), 3)],
        "floor_z_m": round(float(np.median(deep[band, 2])), 4),
    }


def mass_budget(ark: dict, structure_kg: float, pack_kg: float) -> dict[str, float]:
    """All-up mass by group, from the real parts: the harness (every electrical part, with the pack swapped for the
    chosen one), its copper, the props, the pontoon kit, the shell, the payload and a mounting-hardware allowance."""
    idc = ark["industrial_design"]
    prop = next(p for p in ark["candidates"]["propulsion"] if p["name"] == ark["chosen"]["propulsion"])
    harness_file, pontoon_file = variant.ID_DATA / "harness.json", variant.ID_DATA / "pontoon_system.json"
    if harness_file.exists():
        h = json.loads(harness_file.read_text(encoding="utf-8"))
        electrical = sum(c["mass_g"] for c in h["components"] if c["id"] != "pack") / 1000
        copper = h["checks"]["copper_kg"]
    else:  # before the harness existed: sizing's avionics budget
        electrical = 4 * (prop["motor_kg"] + prop["esc_kg"]) + sum(ark["fixed_mass_kg"].values())
        copper = 0.0
    kit = (
        json.loads(pontoon_file.read_text(encoding="utf-8"))["mass"]["kit_kg"]
        if pontoon_file.exists()
        else idc["added_mass_kg"]["inflatable_pontoon_kit"]
    )
    return {
        "structure": structure_kg,
        "pack": pack_kg,
        "electrical_parts": electrical,
        "copper": copper,
        "props": 4 * prop["prop_kg"],
        "pontoon_kit": kit,
        "mounting_hardware": idc["mounting_hardware_kg"],  # shortcut: deck plates, standoffs, fasteners, sealant
        "payload": ark["requirements"]["payload_kg"],
    }


def box_area(size: list[float]) -> float:
    x, y, z = size
    return 2 * (x * y + y * z + x * z)


def variant_mass(idc: dict, pack_size: list[float], body_area: float) -> dict[str, float]:
    """Groups only a variant carries (Ark-1M): a spall liner boxed around the pack and the avionics, and a topcoat
    over the outer shell (body_area counts inner and outer faces, so half of it is the outside)."""
    out = {}
    if arm := idc.get("armour"):
        area = (box_area(pack_size) if arm["covers"]["pack"] else 0.0) + box_area(arm["covers"]["avionics_box_m"])
        out["armour"] = area * arm["areal_kg_m2_per_ply"] * arm["plies"]
    if coat := idc.get("coating"):
        out["coating"] = body_area / 2 * coat["areal_kg_m2"]
    return out


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
    # the external battery leaves an open bay in the tail: its own shape becomes a sealed service hatch that
    # closes the bay flush with the shell (rear bay: spare volume, status light on the hatch face)
    parts["Rear_Hatch"] = (transform(raw["Battery"][0], scale), raw["Battery"][1])
    removed = sorted(n for n in raw if n.startswith(GIMBAL))

    body_v, body_f = parts["GEO_Main_Body"]
    body_area = area(body_v, body_f)
    # the shell is modelled with thickness (closed mesh), so its inner and outer faces are both counted: halve it
    structure_kg = body_area / 2 * idc["shell_wall_m"] * idc["shell_density"]

    # battery: inside the hub's belly well (the deep channel under the centre), cells upright, S along x and P along y
    # The pack can be overridden here: this airframe's own drag (mission_check.py) can need more cells than the
    # hull-model sizing picked.
    pack_name = idc.get("pack", ch["pack"])
    s, p = (int(x) for x in pack_name.removesuffix("P").split("S"))
    cell, case = ark["mechanical"]["cell_21700_m"], ark["mechanical"]["pack_case_m"]
    pack_size = [s * cell["d"] + 2 * case, p * cell["d"] + 2 * case, cell["h"] + 2 * case]
    cell_spec = next(c for c in ark["candidates"]["cells"] if c["name"] == ch["cell"])
    pack_kg = s * p * cell_spec["kg"] * (1 + ark["candidates"]["pack_overhead_frac"])
    pack_wh = s * p * cell_spec["ah"] * cell_spec["v_nom"]
    well = belly_well(body_v, idc["belly_floor_below_m"])
    inset = idc["shell_wall_m"] + ark["mechanical"]["clearance_m"]
    pack_floor = well["floor_z_m"] + inset
    pack_centre = [(well["x_m"][0] + well["x_m"][1]) / 2, 0.0, pack_floor + pack_size[2] / 2]
    deck_z = pack_floor + pack_size[2] + idc["deck_gap_m"]
    fits = (
        pack_size[0] <= well["x_m"][1] - well["x_m"][0] - 2 * inset
        and pack_size[1] <= well["y_m"][1] - well["y_m"][0] - 2 * inset
        and deck_z <= idc["deck_max_z_m"]
    )
    if not fits:
        raise ValueError(f"{pack_name} pack {pack_size} does not fit the belly well {well}")

    # pontoons along the skid bars
    legs = body_v[body_v[:, 2] < idc["skid_z_below_m"]]
    skid_y = float(np.abs(legs[:, 1]).max())
    skid_bottom = float(legs[:, 2].min())
    pt = idc["pontoon"]
    mass = mass_budget(ark, structure_kg, pack_kg) | variant_mass(idc, pack_size, body_area)
    auw = sum(mass.values())
    # pontoon diameter: the smallest (5 mm steps, never below the configured size) that keeps the buoyancy reserve
    need = ark["requirements"]["reserve_buoyancy_frac"]
    while 2 * tube_volume(pt["d_m"], pt["length_m"]) * 1000 / auw - 1 < need:
        pt["d_m"] = round(pt["d_m"] + 0.005, 3)
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
        "mass_kg": {k: round(v, 3) for k, v in mass.items()},
        "battery": {
            "pack": pack_name,
            "pack_kg": round(pack_kg, 3),
            "pack_wh": round(pack_wh, 1),
            "location": "belly well, inside the hub",
            "grid": [s, p],
            "pack_size_m": [round(x, 4) for x in pack_size],
            "pack_centre_m": [round(x, 4) for x in pack_centre],
            "well_m": well,
            "fits": fits,
        },
        "deck_z_m": round(deck_z, 4),
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

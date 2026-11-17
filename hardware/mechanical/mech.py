"""Ark-1 mechanical design: arm tubes, internal packaging, hatch seal, cable glands, payload release.

sizing/size_ark.py calls arm_tube() and packaging() for every candidate, so the chosen config already carries a
real arm tube and a real centre of gravity. This script reports them for the chosen config, adds the seal and
release checks, and writes ark.json -> mechanical_design.

    python mechanical/mech.py            # check, write ark.json
    python mechanical/mech.py --dry-run  # check and print only
"""

import argparse
import json
import math
import sys
from pathlib import Path

HARDWARE = Path(__file__).resolve().parents[1]
ARK_JSON = HARDWARE / "ark.json"
sys.path.insert(0, str(HARDWARE / "sizing"))
from hull import Hull

ROTORS = 4


class DoesNotFit(ValueError):
    pass


def tube_section(od: float, wall: float) -> tuple[float, float]:
    """(area m^2, second moment of area m^4) of a round tube."""
    d = od - 2 * wall
    return math.pi * (od**2 - d**2) / 4, math.pi * (od**4 - d**4) / 64


def cantilever_mode_hz(ei: float, length: float, tip_kg: float, beam_kg: float) -> float:
    """First bending mode of a cantilever with a tip mass (Rayleigh: 0.236 of the beam mass acts at the tip)."""
    return math.sqrt(3 * ei / length**3 / (tip_kg + 0.236 * beam_kg)) / (2 * math.pi)


def rotor_hz(ark: dict, prop_d: float, thrust_n: float) -> float:
    return math.sqrt(thrust_n / (ark["electrical"]["prop_ct"] * ark["environment"]["rho_air"] * prop_d**4))


def arm_root_radius(h: Hull) -> float:
    """Hull outline on the 45 deg arm line, where the deck clamps the arm."""
    return 1 / math.sqrt(0.5 / h.a**2 + 0.5 / h.b**2)


def arm_tube(ark: dict, prop: dict, h: Hull, arm_r: float, auw_kg: float) -> dict:
    """Lightest catalogue tube that is strong, stiff, and keeps its first mode out of the rotor 1P band."""
    mech = ark["mechanical"]
    tube, lim = mech["tube"], mech["arm_limits"]
    g = ark["environment"]["g"]
    prop_d = prop["prop_in"] * 0.0254
    length = arm_r - arm_root_radius(h)
    t_hover = auw_kg * g / ROTORS
    t_max = prop["max_thrust_kg"] * g
    tip_kg = prop["motor_kg"] + prop["prop_kg"] + ark["frame"]["motor_mount_kg"]
    band = (
        lim["band_low"] * rotor_hz(ark, prop_d, lim["min_flight_thrust_frac"] * t_hover),
        lim["band_high"] * rotor_hz(ark, prop_d, t_max),
    )
    best = None
    for od_mm, wall_mm in mech["tubes_od_wall_mm"]:
        if od_mm / wall_mm > tube["max_d_over_t"]:
            continue  # thin walls crush at the clamps
        od, wall = od_mm / 1e3, wall_mm / 1e3
        area, i = tube_section(od, wall)
        ei = tube["e_pa"] * i
        kg_m = area * tube["density"] * (1 + tube["fitting_overhead_frac"])
        row = {
            "tube_mm": f"{od_mm}x{wall_mm}",
            "od_m": od,
            "kg_per_m": kg_m,
            "mode_hz": cantilever_mode_hz(ei, length, tip_kg, area * tube["density"] * length),
            "sf": tube["flex_strength_pa"] / (t_max * length * (od / 2) / i),
            "hover_deflection_m": t_hover * length**3 / (3 * ei),
        }
        ok = (
            row["sf"] >= lim["sf_min"]
            and row["hover_deflection_m"] <= lim["hover_deflection_max_m"]
            and not band[0] <= row["mode_hz"] <= band[1]
        )
        if ok and (best is None or kg_m < best["kg_per_m"]):
            best = row
    if best is None:
        raise DoesNotFit("no arm tube passes")
    return best | {"free_length_m": length, "rotor_1p_band_hz": list(band)}


def pack_box(ark: dict, series: int, parallel: int) -> list[float]:
    """Cells upright in a series x parallel grid, plus the case."""
    c, case = ark["mechanical"]["cell_21700_m"], ark["mechanical"]["pack_case_m"]
    return [series * c["d"] + 2 * case, parallel * c["d"] + 2 * case, c["h"] + 2 * case]


def inner_fits(h: Hull, inset: float, centre: list[float], size: list[float]) -> bool:
    ai, bi, ci = h.a - inset, h.b - inset, h.c - inset
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                x, y, z = (centre[k] + s * size[k] / 2 for k, s in enumerate((sx, sy, sz)))
                if (x / ai) ** 2 + (y / bi) ** 2 + ((z - h.c) / ci) ** 2 > 1:
                    return False
    return True


def overlaps_xy(p: dict, q: dict) -> bool:
    return all(abs(p["centre_m"][k] - q["centre_m"][k]) < (p["size_m"][k] + q["size_m"][k]) / 2 for k in (0, 1))


def packaging(ark: dict, h: Hull, pack_size: list[float], pack_kg: float) -> dict:
    """Drop each internal part (battery first) at its x, y to the lowest height where it fits on what is below.

    z is measured up from the hull bottom. Raises DoesNotFit if a part does not fit.
    """
    mech = ark["mechanical"]
    inset = mech["wall_m"] + mech["clearance_m"]
    fixed = ark["fixed_mass_kg"]
    parts = [{"name": "battery", "size_m": pack_size, "xy_m": [0.0, 0.0], "mass": "pack"}, *mech["internal_parts"]]
    placed = []
    for part in parts:
        size, (x, y) = part["size_m"], part["xy_m"]
        p = {"name": part["name"], "size_m": size, "centre_m": [x, y, 0.0], "mass": part["mass"]}
        z = max([q["centre_m"][2] + q["size_m"][2] / 2 for q in placed if overlaps_xy(p, q)], default=0.0)
        while not inner_fits(h, inset, [x, y, z + size[2] / 2], size):
            z += 0.002
            if z + size[2] > 2 * h.c:
                raise DoesNotFit(f"{part['name']} does not fit in the hull")
        p["centre_m"][2] = z + size[2] / 2
        p["kg"] = pack_kg if part["mass"] == "pack" else fixed[part["mass"]]
        placed.append(p)

    pod = mech["pod"]
    pod_z = -pod["gap_m"] - pod["size_m"][2] / 2
    skid_bottom = pod_z - pod["size_m"][2] / 2 - mech["skids"]["ground_gap_m"]
    z_of = {p["mass"]: p["centre_m"][2] for p in placed}
    z_of |= {k: f * 2 * h.c for k, f in mech["shell_parts_z_frac"].items()}
    z_of["landing_skids"] = skid_bottom / 2
    missing = set(fixed) - set(z_of)
    if missing:
        raise ValueError(f"fixed masses with no position: {sorted(missing)}")
    return {
        "parts": placed,
        "battery_z_m": z_of["pack"],
        "payload_z_m": pod_z,
        "fixed_z_m": sum(fixed[k] * z_of[k] for k in fixed) / sum(fixed.values()),
        "skid_bottom_z_m": skid_bottom,
    }


def ellipse_perimeter(a: float, b: float) -> float:
    h = ((a - b) / (a + b)) ** 2  # Ramanujan II
    return math.pi * (a + b) * (1 + 3 * h / (10 + math.sqrt(4 - 3 * h)))


def seals(ark: dict, h: Hull) -> dict:
    """Clamshell hull split at the equator: O-ring face seal on the flange, bolted lid; cable glands; release servo."""
    mech, env = ark["mechanical"], ark["environment"]
    s = mech["seal"]
    a, b = h.a - s["flange_inset_m"], h.b - s["flange_inset_m"]
    perimeter = ellipse_perimeter(a, b)
    d = s["cord_d_mm"]
    depth = d * (1 - s["squeeze_target"])
    width = math.pi * d * d / 4 / (0.75 * depth)  # gland sized for 75 % fill
    fill = math.pi * d * d / 4 / (depth * width)
    force = s["oring_force_n_per_mm"] * perimeter * 1e3 + env["rho_water"] * env["g"] * s["depth_m"] * math.pi * a * b
    bolts = max(math.ceil(s["bolt_sf"] * force / s["bolt_preload_n"]), math.ceil(perimeter / s["bolt_spacing_max_m"]))
    squeeze = (d - depth) / d
    rel = mech["release"]
    torque = rel["friction"] * rel["dynamic_factor"] * ark["requirements"]["payload_kg"] * env["g"] * rel["horn_r_m"]
    glands = [g | {"ok": g["range_mm"][0] <= g["cable_od_mm"] <= g["range_mm"][1]} for g in mech["glands"]]
    return {
        "oring_length_m": perimeter,
        "gland_depth_mm": depth,
        "gland_width_mm": width,
        "squeeze": squeeze,
        "fill": fill,
        "clamp_force_n": force,
        "bolts": bolts,
        "glands": glands,
        "release_torque_nm": torque,
        "release_sf": rel["servo_rated_nm"] / torque,
        "ok": s["squeeze_range"][0] <= squeeze <= s["squeeze_range"][1]
        and fill <= s["fill_max"]
        and all(g["ok"] for g in glands)
        and rel["servo_rated_nm"] / torque >= rel["sf_min"],
    }


def chosen_hull(ark: dict) -> Hull:
    g = ark["chosen"]["geometry_m"]
    return Hull(g["hull_length"] / 2, g["hull_width"] / 2, g["hull_height"] / 2)


def rounded(x):
    if isinstance(x, float):
        return round(x, 4)
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    if isinstance(x, list):
        return [rounded(v) for v in x]
    return x


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print only, do not write ark.json")
    args = ap.parse_args()
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    ch = ark["chosen"]
    h = chosen_hull(ark)
    prop = next(p for p in ark["candidates"]["propulsion"] if p["name"] == ch["propulsion"])
    s, p = (int(x) for x in ch["pack"].removesuffix("P").split("S"))
    res = rounded(
        {
            "arms": arm_tube(ark, prop, h, ch["geometry_m"]["arm_radius"], ch["mass_kg"]["all_up"]),
            "packaging": packaging(ark, h, pack_box(ark, s, p), ch["mass_kg"]["pack"]),
            "seals": seals(ark, h),
        }
    )
    arm, pk, sl = res["arms"], res["packaging"], res["seals"]
    lo, hi = arm["rotor_1p_band_hz"]
    print(
        f"Arms: {arm['tube_mm']} mm carbon, free length {arm['free_length_m']:.3f} m, {arm['kg_per_m']:.3f} kg/m, "
        f"mode {arm['mode_hz']:.1f} Hz (1P band {lo:.1f}-{hi:.1f} Hz), SF {arm['sf']:.1f}, "
        f"hover deflection {arm['hover_deflection_m'] * 1e3:.2f} mm"
    )
    for part in pk["parts"]:
        print(f"  {part['name']:40} centre z {part['centre_m'][2]:.3f} m")
    print(
        f"Seal: O-ring {sl['oring_length_m']:.3f} m, gland {sl['gland_depth_mm']:.2f} x {sl['gland_width_mm']:.2f} mm, "
        f"squeeze {sl['squeeze']:.2f}, fill {sl['fill']:.2f}, {sl['bolts']} bolts; release SF {sl['release_sf']:.1f}"
    )
    if not args.dry_run:
        ark["mechanical_design"] = res
        ARK_JSON.write_text(json.dumps(ark, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {ARK_JSON.name}")
    return 0 if sl["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

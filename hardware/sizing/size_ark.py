"""Size the Ark: search every power set x cell x parallel count, keep the lightest that flies the mission and floats.

    python sizing/size_ark.py            # solve, print the table, write 'chosen' + 'runners_up' to ark.json
    python sizing/size_ark.py --dry-run  # solve and print only

Power model (per rotor, then x4):
  hover    P = T * v_h / FM / eta                          (momentum theory + figure of merit)
  forward  P = (T * v_i + P0 * (1 + 4.65 mu^2) + D * V) / eta
           v_i from Glauert's forward-flight inflow, P0 = profile power = T * v_h * (1/FM - 1)
"""

import argparse
import json
import math
import sys
from pathlib import Path

from hull import float_check, hull_for_volume

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mechanical"))
import mech

ARK_JSON = Path(__file__).resolve().parent.parent / "ark.json"
TIP_SPEED = 150.0  # shortcut: fixed rotor tip speed for the advance ratio, use the real rpm once a prop is chosen
ROTORS = 4


def induced_hover(thrust: float, disk_area: float, rho: float) -> float:
    return math.sqrt(thrust / (2 * rho * disk_area))


def induced_forward(v_h: float, speed: float) -> float:
    """Glauert inflow with the disk near edge-on: v_i^4 + V^2 v_i^2 - v_h^4 = 0."""
    return math.sqrt((-(speed**2) + math.sqrt(speed**4 + 4 * v_h**4)) / 2)


def hover_power(weight_n: float, disk_area: float, fm: float, eta: float, rho: float) -> float:
    t = weight_n / ROTORS
    return ROTORS * t * induced_hover(t, disk_area, rho) / fm / eta


def forward_power(
    weight_n: float, speed: float, cda: float, disk_area: float, fm: float, eta: float, rho: float
) -> float:
    drag = 0.5 * rho * speed**2 * cda
    t = math.hypot(weight_n, drag) / ROTORS
    v_h = induced_hover(t, disk_area, rho)
    p0 = t * v_h * (1 / fm - 1)
    mu = speed / TIP_SPEED
    per_rotor = t * induced_forward(v_h, speed) + p0 * (1 + 4.65 * mu**2)
    return (ROTORS * per_rotor + drag * speed) / eta


def best_cruise(weight_n: float, dist_m: float, cda: float, area: float, prop: dict, rho: float, v_range) -> tuple:
    """(energy J, speed m/s) for the speed in v_range that uses the least energy over dist_m."""
    best = None
    for v in range(int(v_range[0]), int(v_range[1]) + 1):
        e = forward_power(weight_n, v, cda, area, prop["fm"], prop["eta_drive"], rho) * dist_m / v
        if best is None or e < best[0]:
            best = (e, float(v))
    return best


def solve(ark: dict, prop: dict, cell: dict, parallel: int) -> dict:
    req, env, frame, hc, cand = ark["requirements"], ark["environment"], ark["frame"], ark["hull"], ark["candidates"]
    g, rho = env["g"], env["rho_air"]
    s = cand["series_cells"]

    d = prop["prop_in"] * 0.0254
    area = math.pi * d * d / 4
    arm_r = (1 + frame["prop_gap_frac"]) * d / math.sqrt(2)  # adjacent rotors clear each other on a quad X
    power_set_kg = ROTORS * (prop["motor_kg"] + prop["prop_kg"] + prop["esc_kg"])
    pack_kg = s * parallel * cell["kg"] * (1 + cand["pack_overhead_frac"])
    pack_wh = s * parallel * cell["ah"] * cell["v_nom"]
    pack_size = mech.pack_box(ark, s, parallel)
    fixed_kg = sum(ark["fixed_mass_kg"].values())
    payload = req["payload_kg"]

    # Hull size, arm tube and all-up mass depend on each other: iterate to a fixed point. Then pack the parts
    # inside; if they do not fit, grow the hull and repeat (the shell is sized from what it holds).
    vol_mult = 1.0
    for _ in range(40):
        shell_kg, arms_kg = 0.0, ROTORS * frame["motor_mount_kg"]
        for _ in range(30):
            auw = fixed_kg + arms_kg + power_set_kg + pack_kg + payload + shell_kg
            volume = auw / env["rho_water"] * (1 + req["reserve_buoyancy_frac"]) * vol_mult
            h = hull_for_volume(volume, hc["aspect_width"], hc["aspect_height"], hc["min_length_m"])
            shell_kg = h.area * hc["shell_kg_per_m2"]
            tube = mech.arm_tube(ark, prop, h, arm_r, auw)
            arms_kg = ROTORS * (arm_r * tube["kg_per_m"] + frame["motor_mount_kg"])
        auw = fixed_kg + arms_kg + power_set_kg + pack_kg + payload + shell_kg
        try:
            layout = mech.packaging(ark, h, pack_size, pack_kg)
            break
        except mech.DoesNotFit:
            vol_mult *= ark["mechanical"]["hull_grow_step"] ** 3
    else:
        raise ValueError("parts never fit in the hull")

    cda = (
        hc["cd_hull"] * h.frontal_area
        # only the free length is in the airflow, and arms at 45 deg see (V cos 45)^2 (cross-flow principle)
        + ROTORS * frame["cd_arm"] * tube["od_m"] * tube["free_length_m"] * 0.5
        + ROTORS * frame["motor_frontal_m2"]
        + frame["cda_extras_m2"]
    )
    w_out, w_back = auw * g, (auw - payload) * g
    fm, eta = prop["fm"], prop["eta_drive"]

    cda_out = cda + req["payload_cda_m2"]  # the payload pod hangs under the hull until it is dropped
    e_out, v_out = best_cruise(
        w_out, req["range_out_km"] * 1e3, cda_out, area, prop, rho, req["cruise_speed_range_mps"]
    )
    e_back, v_back = best_cruise(
        w_back, req["range_back_km"] * 1e3, cda, area, prop, rho, req["cruise_speed_range_mps"]
    )
    p_hover_out = hover_power(w_out, area, fm, eta, rho)
    p_hover_back = hover_power(w_back, area, fm, eta, rho)
    e_hover = p_hover_out * (req["hover_out_s"] + req["water_ops_s"]) + p_hover_back * req["hover_back_s"]
    mission_wh = (e_out + e_back + e_hover) / 3600
    usable_wh = pack_wh * cand["usable_dod"]
    needed_wh = mission_wh / (1 - req["reserve_frac"])

    # Peak current at the thrust needed for the minimum thrust-to-weight ratio.
    p_peak = hover_power(w_out * req["twr_min"], area, fm, eta, rho)
    i_peak = p_peak / (s * cell["v_nom"])
    twr = ROTORS * prop["max_thrust_kg"] / auw

    z_top = 2 * h.c
    lz = hc["layout_z_frac"]
    prop_z = lz["arms"] * z_top + frame["motor_pylon_m"]  # props on pylons above the arm line
    masses = [
        (pack_kg, layout["battery_z_m"]),
        (payload, layout["payload_z_m"]),
        (fixed_kg, layout["fixed_z_m"]),
        (shell_kg, lz["shell"] * z_top),
        (arms_kg, lz["arms"] * z_top),
        (power_set_kg, prop_z),
    ]
    fl = float_check(h, masses, env["rho_water"], prop_z)

    checks = {
        "energy": usable_wh >= needed_wh,
        "thrust_to_weight": twr >= req["twr_min"],
        "pack_current": parallel * cell["max_a"] >= i_peak,
        "prop_clearance": fl["prop_clearance_m"] >= req["prop_clearance_min_m"],
        "stability": fl["gm_m"] >= req["gm_min_m"],
    }
    return {
        "propulsion": prop["name"],
        "cell": cell["name"],
        "pack": f"{s}S{parallel}P",
        "feasible": all(checks.values()),
        "checks": checks,
        "energy_margin": usable_wh / needed_wh,
        "mass_kg": {
            "all_up": auw,
            "payload": payload,
            "pack": pack_kg,
            "power_set": power_set_kg,
            "arms": arms_kg,
            "hull_shell": shell_kg,
            "fixed": fixed_kg,
        },
        "geometry_m": {
            "prop_d": d,
            "arm_radius": arm_r,
            "span_tip_to_tip": 2 * arm_r + d,
            "hull_length": 2 * h.a,
            "hull_width": 2 * h.b,
            "hull_height": 2 * h.c,
            "hull_volume_l": h.volume * 1e3,
            "cda_m2": cda,
            "cda_out_m2": cda_out,
        },
        "power_w": {
            "hover_loaded": p_hover_out,
            "hover_empty": p_hover_back,
            "cruise_out": e_out / (req["range_out_km"] * 1e3 / v_out),
            "cruise_back": e_back / (req["range_back_km"] * 1e3 / v_back),
            "peak_at_twr_min": p_peak,
        },
        "cruise_speed_mps": {"out": v_out, "back": v_back},
        "energy_wh": {"pack": pack_wh, "usable": usable_wh, "mission": mission_wh, "needed_with_reserve": needed_wh},
        "pack_peak_current_a": i_peak,
        "thrust_to_weight": twr,
        "flight_time_min": (req["range_out_km"] * 1e3 / v_out + req["range_back_km"] * 1e3 / v_back) / 60
        + (req["hover_out_s"] + req["water_ops_s"] + req["hover_back_s"]) / 60,
        "float_loaded": fl,
        "arm_tube": tube,
        "layout_z_m": {k: layout[k] for k in ("battery_z_m", "payload_z_m", "fixed_z_m", "skid_bottom_z_m")},
        "hull_grown_for_fit": vol_mult > 1,
    }


def search(ark: dict) -> list[dict]:
    cand = ark["candidates"]
    lo, hi = cand["parallel_range"]
    results = []
    for prop in cand["propulsion"]:
        for cell in cand["cells"]:
            for p in range(lo, hi + 1):
                try:
                    results.append(solve(ark, prop, cell, p))
                except ValueError:
                    continue  # hull sinks: not a candidate
    return results


def rounded(x):
    if isinstance(x, float):
        return round(x, 4)
    if isinstance(x, dict):
        return {k: rounded(v) for k, v in x.items()}
    return x


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="print only, do not write ark.json")
    args = ap.parse_args()

    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    results = search(ark)
    feasible = sorted((r for r in results if r["feasible"]), key=lambda r: r["mass_kg"]["all_up"])

    print(f"{len(feasible)} of {len(results)} configs close the mission; lightest 10:")
    print(f"{'power set':34} {'cell':38} {'pack':6} {'AUW kg':>7} {'margin':>7} {'T/W':>5}")
    for r in feasible[:10]:
        print(
            f"{r['propulsion']:34} {r['cell']:38} {r['pack']:6} {r['mass_kg']['all_up']:7.2f} "
            f"{r['energy_margin']:7.2f} {r['thrust_to_weight']:5.2f}"
        )

    if not feasible:
        best = max(results, key=lambda r: r["energy_margin"])
        print(
            f"\nNo config closes the mission. Best energy margin {best['energy_margin']:.2f}: {best['propulsion']}, {best['pack']}."
        )
        return 1

    chosen = feasible[0]
    print(
        f"\nChosen: {chosen['propulsion']}, {chosen['cell']} {chosen['pack']}: "
        f"{chosen['mass_kg']['all_up']:.2f} kg all-up, {chosen['flight_time_min']:.0f} min mission, "
        f"energy margin {chosen['energy_margin']:.2f}"
    )
    if not args.dry_run:
        ark["chosen"] = rounded(chosen)
        ark["runners_up"] = [
            rounded(
                {k: r[k] for k in ("propulsion", "cell", "pack", "energy_margin")}
                | {"all_up_kg": r["mass_kg"]["all_up"]}
            )
            for r in feasible[1:5]
        ]
        ARK_JSON.write_text(json.dumps(ark, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {ARK_JSON.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

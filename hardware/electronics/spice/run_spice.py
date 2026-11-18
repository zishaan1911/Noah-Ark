"""Check Ark-1's power chain in ngspice and write the results to ark.json -> power_chain.

    python electronics/spice/run_spice.py            # run, print, write ark.json
    python electronics/spice/run_spice.py --dry-run  # run and print only

1. ESC + motor at hover, on a 20 % pack: duty sweep -> duty for hover shaft power, efficiency.
2. Bus, full and 20 % pack: hover, then all four ESCs ramp to sizing's peak current.
"""

import argparse
import itertools
import json
import math
import sys
from pathlib import Path

import spice

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import variant  # ARK_VARIANT picks Ark-1 or a variant folder

ARK_JSON = variant.ARK_JSON
ROTORS = 4


def airframe(ark: dict) -> dict:
    """Mass, pack and powers to simulate: the built airframe (industrial_design) when it exists, else sizing's pick.
    Hover and peak power scale with mass^1.5 (momentum theory) from sizing's figures."""
    ch = ark["chosen"]
    built = ark.get("industrial_design", {}).get("result")
    if not built:
        return {
            "all_up": ch["mass_kg"]["all_up"],
            "pack": ch["pack"],
            "hover_w": ch["power_w"]["hover_loaded"],
            "peak_a": ch["pack_peak_current_a"],
        }
    k = (built["auw_estimate_kg"] / ch["mass_kg"]["all_up"]) ** 1.5
    return {
        "all_up": built["auw_estimate_kg"],
        "pack": built["battery"]["pack"],
        "hover_w": ch["power_w"]["hover_loaded"] * k,
        "peak_a": ch["pack_peak_current_a"] * k,
    }


def hover_point(ark: dict) -> dict:
    """Rotor speed and shaft power per rotor at loaded hover, from the same momentum model sizing uses."""
    ch, env, el = ark["chosen"], ark["environment"], ark["electrical"]
    prop = next(p for p in ark["candidates"]["propulsion"] if p["name"] == ch["propulsion"])
    t = airframe(ark)["all_up"] * env["g"] / ROTORS
    d = ch["geometry_m"]["prop_d"]
    area = math.pi * d * d / 4
    p_shaft = t * math.sqrt(t / (2 * env["rho_air"] * area)) / prop["fm"]
    n = math.sqrt(t / (el["prop_ct"] * env["rho_air"] * d**4))  # T = Ct rho n^2 D^4, n in rev/s
    ke = 60 / (2 * math.pi * el["motor"]["kv"])
    w = 2 * math.pi * n
    return {
        "thrust_n": t,
        "rpm": n * 60,
        "wm_rad_s": w,
        "ke_v_s_rad": ke,
        "p_shaft_w": p_shaft,
        "p_target_w": p_shaft + ke * el["motor"]["i0_a"] * w,  # + no-load (iron/friction) loss
        "eta_drive_assumed": prop["eta_drive"],
    }


def pack(ark: dict) -> tuple[int, int, dict]:
    s, p = (int(x) for x in airframe(ark)["pack"].removesuffix("P").split("S"))
    cell = ark["electrical"]["cell"]
    return (
        s,
        p,
        {
            "rp0": f"{s * cell['r0_ohm'] / p:.6g}",
            "rp1": f"{s * cell['r1_ohm'] / p:.6g}",
            "cp1": f"{cell['c1_f'] * p / s:.6g}",
        },
    )


def esc_params(ark: dict, hp: dict, vbus: float) -> tuple[dict, dict]:
    """(.param overrides, {TSTOP, TW}) for esc_bldc.cir: settle 3 electrical periods, measure the 4th."""
    el = ark["electrical"]
    m = el["motor"]
    te = 2 * math.pi / (hp["wm_rad_s"] * m["pole_pairs"])
    subs = {"TSTOP": f"{4 * te:.6g}", "TW": f"{3 * te:.6g}"}
    params = {
        "vbus": f"{vbus:.4g}",
        "wm": f"{hp['wm_rad_s']:.6g}",
        "pp": m["pole_pairs"],
        "ke": f"{hp['ke_v_s_rad']:.6g}",
        "fpwm": el["esc"]["fpwm_hz"],
        "rph": m["rph_ohm"],
        "lph": m["lph_h"],
        "ron": el["esc"]["ron_ohm"],
        "cloc": el["esc"]["local_c_f"],
    }
    return params, subs


def esc_hover(ark: dict, hp: dict, vbus: float) -> dict:
    base, subs = esc_params(ark, hp, vbus)
    d0 = hp["ke_v_s_rad"] * hp["wm_rad_s"] / vbus  # duty that just matches back-EMF
    target = hp["p_target_w"]
    sweep = []
    for k in range(15):  # step the duty until the shaft power passes the target (a heavier variant needs more)
        d = round(d0 + 0.02 * k, 4)
        sweep.append((d, spice.run("esc_bldc.cir", f"esc_d{int(d * 1e4)}", base | {"duty": d}, subs)["pmech"]))
        if len(sweep) >= 6 and sweep[-1][1] >= target:  # at least Ark-1's six points, so its stored sweep is unchanged
            break
    if any(p2 <= p1 for (_, p1), (_, p2) in itertools.pairwise(sweep)):
        raise RuntimeError(f"shaft power does not rise with duty (unstable sim?): {sweep}")
    for (d1, p1), (d2, p2) in itertools.pairwise(sweep):
        if p1 <= target <= p2:
            duty = d1 + (target - p1) / (p2 - p1) * (d2 - d1)
            break
    else:
        raise RuntimeError(f"hover power {target:.0f} W outside duty sweep {sweep}")
    r = spice.run("esc_bldc.cir", "esc_hover", base | {"duty": f"{duty:.5f}"}, subs)
    p_in = -r["ibus"] * vbus
    return {
        "vbus_v": vbus,
        "duty": duty,
        "p_mech_w": r["pmech"],
        "p_in_w": p_in,
        "ibus_a": -r["ibus"],
        "iph_rms_a": r["iph_rms"],
        "efficiency": hp["p_shaft_w"] / p_in,
        "sweep": [{"duty": d, "p_mech_w": p} for d, p in sweep],
    }


def bus(ark: dict, esc: dict, ocv_cell: float, name: str) -> dict:
    el, cell = ark["electrical"], ark["electrical"]["cell"]
    s, _, pk = pack(ark)
    vocv = s * ocv_cell
    # Same shaft power at a different bus voltage: duty and current scale ~ 1/V.
    d0 = min(0.97, esc["duty"] * esc["vbus_v"] / vocv)
    i_esc = esc["ibus_a"] * esc["vbus_v"] / vocv
    i_pk = airframe(ark)["peak_a"] * s * ark_cell(ark)["v_nom"] / vocv / ROTORS
    params = pk | {
        "vocv": f"{vocv:.4g}",
        "rh": el["harness"]["r_ohm"],
        "lh": el["harness"]["l_h"],
        "cbulk": el["bulk"]["c_f"],
        "resr": el["bulk"]["esr_ohm"],
        "cesc": f"{ROTORS * el['esc']['local_c_f']:.6g}",
        "irail": f"{el['avionics_w'] / vocv:.4g}",
        "fpwm": el["esc"]["fpwm_hz"],
        "iph0": f"{i_esc / d0:.4g}",
        "d0": f"{d0:.4g}",
        "iphpk": f"{i_pk / 0.97:.4g}",
    }
    r = spice.run("battery_bus.cir", f"bus_{name}", params)
    return r | {"vocv": vocv, "vcell_min_peak": r["vmin_peak"] / s, "cutoff_load_v": cell["cutoff_load_v"]}


def ark_cell(ark: dict) -> dict:
    return next(c for c in ark["candidates"]["cells"] if c["name"] == ark["chosen"]["cell"])


def run_all(ark: dict) -> dict:
    hp = hover_point(ark)
    s, _, pk = pack(ark)
    el = ark["electrical"]
    # Hover bus voltage on a 20 % pack: OCV minus the ohmic drop at the sizing hover current (worst case for duty).
    i_hover = airframe(ark)["hover_w"] / (s * ark_cell(ark)["v_nom"])
    v_low = s * el["cell"]["ocv_low_v"] - i_hover * (float(pk["rp0"]) + el["harness"]["r_ohm"])
    esc = esc_hover(ark, hp, v_low)
    buses = {k: bus(ark, esc, el["cell"][f"ocv_{k}_v"], k) for k in ("full", "low")}
    checks = {
        "bus_above_cutoff": all(b["vcell_min_peak"] >= b["cutoff_load_v"] for b in buses.values()),
        "duty_headroom": esc["duty"] <= el["esc"]["duty_max"],
        "efficiency_vs_sizing": esc["efficiency"] >= hp["eta_drive_assumed"],
    }
    return {"hover": hp, "esc_hover_low_pack": esc, "bus": buses, "checks": checks}


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
    res = rounded(run_all(ark))
    hp, esc = res["hover"], res["esc_hover_low_pack"]
    print(f"Hover: {hp['rpm']:.0f} rpm, {hp['p_shaft_w']:.0f} W shaft per rotor")
    print(f"ESC on 20 % pack ({esc['vbus_v']:.1f} V): duty {esc['duty']:.3f}, efficiency {esc['efficiency']:.3f}")
    for k, b in res["bus"].items():
        print(
            f"Bus {k}: hover {b['vavg_hover']:.2f} V, peak min {b['vmin_peak']:.2f} V ({b['vcell_min_peak']:.3f} V/cell)"
        )
    print("Checks:", res["checks"])
    if not args.dry_run:
        ark["power_chain"] = res
        ARK_JSON.write_text(json.dumps(ark, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {ARK_JSON.name}")
    return 0 if all(res["checks"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())

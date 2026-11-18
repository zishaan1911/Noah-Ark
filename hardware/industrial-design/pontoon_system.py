"""Ark-1 inflatable pontoon system: hardware, gas sizing, inflation time, firing height.

    python industrial-design/pontoon_system.py   # ark.json -> industrial-design/pontoon_system.json + flight/pontoon.parm

One side = folded TPU-nylon bladder in a tear-open cover on the skid runner, a 60 g CO2 cylinder on a
Halkey-Roberts manual inflator head, fired by a spring puller released by a 12 V latch solenoid
(no pyrotechnics), a pressure switch to confirm, and a relief valve. The flight controller fires both sides
at a height above the water (radar) that leaves time for full inflation before touchdown.

Numbers marked "est." are engineering estimates, not datasheet values; the bench test list in
flight/README.md says how to replace them with measurements.
"""

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant  # ARK_VARIANT picks Ark-1 or a variant folder

ARK_JSON = variant.ARK_JSON
OUT_JSON = variant.ID_DATA / "pontoon_system.json"
OUT_PARM = variant.FLIGHT / "pontoon.parm"

# ---- CO2 properties (Span & Wagner 1996 ancillary equations, valid triple point .. critical point)
R_CO2 = 188.92  # J/kg K
GAMMA = 1.30  # vapour, used for choked flow and the bag's ideal-gas energy balance
CV = R_CO2 / (GAMMA - 1)
CP = CV + R_CO2
T_CRIT, P_CRIT, RHO_CRIT = 304.1282, 7.3773e6, 467.6
T_TRIPLE = 216.59
P_ATM = 101_325.0
MU_JT = 1.1e-5  # K/Pa, Joule-Thomson coefficient of CO2 near room temperature (about 1.1 K/bar), est.


def p_sat(t: float) -> float:
    """Vapour pressure of CO2 [Pa] at temperature t [K]."""
    x = 1 - t / T_CRIT
    s = -7.0602087 * x + 1.9391218 * x**1.5 - 1.6463597 * x**2 - 3.2995634 * x**4
    return P_CRIT * math.exp(T_CRIT / t * s)


def rho_vap(t: float) -> float:
    """Saturated vapour density of CO2 [kg/m3]."""
    x = 1 - t / T_CRIT
    s = -1.7074879 * x**0.34 - 0.8227467 * x**0.5 - 4.6008549 * x - 10.111178 * x ** (7 / 3) - 29.742252 * x ** (14 / 3)
    return RHO_CRIT * math.exp(s)


def latent_heat(t: float) -> float:
    """Heat of vaporisation [J/kg]: Watson correlation through 234.5 kJ/kg at 0 C."""
    return 234.5e3 * ((1 - t / T_CRIT) / (1 - 273.15 / T_CRIT)) ** 0.38


def choked_flux(p: float, rho: float) -> float:
    """Choked mass flux [kg/m2 s] of the cylinder vapour through the inflator orifice."""
    return math.sqrt(GAMMA * p * rho) * (2 / (GAMMA + 1)) ** ((GAMMA + 1) / (2 * (GAMMA - 1)))


def gas_mass(p_gauge: float, volume: float, t: float) -> float:
    """CO2 mass [kg] that fills `volume` [m3] at gauge pressure `p_gauge` [Pa] and temperature `t` [K]."""
    return (P_ATM + p_gauge) * volume / (R_CO2 * t)


def capsule_area(d: float, length: float) -> float:
    return math.pi * d * (length - d) + math.pi * d * d


# ---- design decisions (each one is a choice; the reasoning is in the json "decisions")
DESIGN = {
    "working_gauge_kpa": 25.0,  # inflatable-boat tube pressure (0.2-0.25 bar): stiff enough to carry the drone
    "switch_gauge_kpa": 12.0,  # pressure switch closes: bag is at full volume and holding pressure
    "relief_gauge_kpa": 35.0,  # relief valve cracks: vents surplus gas and sun heating
    "unfold_gauge_kpa": 1.5,  # pressure needed to unfurl the folded bladder, est.
    "sizing_gas_t_k": 263.0,  # bag gas right after a fast fill is cold (expansion); size the cartridge for -10 C
    "cylinder_residual_frac": 0.05,  # gas left in the cylinder as dry ice / heel when it is needed, est.
    "cartridge_margin_min": 1.25,
    "standard_cartridges_g": [16, 24, 33, 38, 45, 60],  # threaded lifejacket / buoy CO2 sizes
    "orifice_d_mm": 1.0,  # effective pierced-seal orifice of the inflator head, est.
    "orifice_cd": 0.8,
    "cylinder_fill_g_per_ml": 0.68,  # CO2 fill density of lifejacket cylinders, est. (<= 0.75 allowed)
    "bag_wall_h_w_m2k": 15.0,  # heat transfer through the thin bladder wall, est.
    "ambient_c": {"nominal": 30.0, "cold": 15.0},  # Sabah/Sarawak flood ops; the cold case sets the timing
    "actuation_s": 0.15,  # latch solenoid releases, spring pulls the lever, pin pierces the seal, est.
    "land_speed_mps": 0.5,  # ArduPilot LAND_SPEED default (final descent below LAND_ALT_LOW = 10 m)
    "timing_margin": 1.5,  # fire early enough for 1.5 x the inflation time
    "abort_alt_m": 1.5,  # planned landing: still high enough to stop and climb if a side fails
    "tube_gap_m": 0.004,  # tube sits outboard of the runner, with the flattened cover between them
    "fabric": {
        "name": "210D nylon oxford, TPU-coated, RF/hot-air welded",
        "areal_kg_m2": 0.19,  # est., typical 210D TPU-coated nylon
        "tensile_n_per_50mm": 1000.0,  # est., typical datasheet range 900-1500 N/50 mm
        "seam_efficiency": 0.7,  # welded lap seam vs parent fabric, est.
        "seam_allowance": 0.12,  # extra fabric for seams, end caps and attachment patches
    },
}

# Real parts (mass in kg; "est." where no datasheet number was found)
PARTS = [
    {
        "role": "CO2 cylinder",
        "product": "60 g CO2 cylinder, 1/2-20 UNF thread (275 N lifejacket size, e.g. Lalizas 02197)",
        "size_mm": "Ø32 × 165 est.",
        "mass_kg": 0.25,
        "mass_note": "est.: scaled from 33 g cylinders (Ø26 × 138 mm, 135-156 g gross)",
        "source": "https://yachtneeds.com/lalizas-60g-co-cylinder-for-inflatable-lifejackets-02197",
        "per_side": 1,
    },
    {
        "role": "Inflator head",
        "product": "Halkey-Roberts Alpha-series manual inflator, 1/2-20 UNF, pull-lever (Nordson MEDICAL)",
        "size_mm": "≈ 45 × 30 × 25 est.",
        "mass_kg": 0.035,
        "mass_note": "est.",
        "source": "https://fluid-components.nordsonmedical.com/Products/Halkey-Roberts-Components/Inflation-Products/",
        "per_side": 1,
    },
    {
        "role": "Firing actuator",
        "product": "Spring lanyard puller (100 N preload, hand-cocked on re-arm) held by a 12 V push-pull latch solenoid",
        "size_mm": "50 × 30 × 30 est.",
        "mass_kg": 0.07,
        "mass_note": "est.",
        "source": "",
        "per_side": 1,
    },
    {
        "role": "Pressure switch",
        "product": "Multicomp PSF102-7651-713 diaphragm switch, 0.541-2.17 psi adjustable, set 1.74 psi (12 kPa)",
        "size_mm": "≈ Ø27 × 30 est.",
        "mass_kg": 0.02,
        "mass_note": "est.",
        "source": "https://www.farnell.com/datasheets/2015041.pdf",
        "per_side": 1,
    },
    {
        "role": "Relief valve",
        "product": "Inflatable-boat pressure relief valve, cracking 35 kPa (5 psi), ≥ Ø10 mm flow port",
        "size_mm": "Ø30 × 20 est.",
        "mass_kg": 0.015,
        "mass_note": "est.",
        "source": "",
        "per_side": 1,
    },
    {
        "role": "Hose + inlet valve",
        "product": "Ø6 mm braided PU hose, 1/8 BSP tee, bladder inlet check valve",
        "size_mm": "≈ 120 long",
        "mass_kg": 0.025,
        "mass_note": "est.",
        "source": "",
        "per_side": 1,
    },
    {
        "role": "Cover + straps",
        "product": "500D TPU-coated Cordura tray + lid, hook-and-loop tear seam, 3 × 25 mm nylon straps",
        "size_mm": "360 × 47 × 51",
        "mass_kg": 0.06,
        "mass_note": "est.",
        "source": "",
        "per_side": 1,
    },
    {
        "role": "Firing driver",
        "product": "2-stage driver board: ARM high-side IRLML2244 P-FET + per-side FIRE IRLML6344 N-FET, flyback diodes",
        "size_mm": "30 × 20 × 5",
        "mass_kg": 0.01,
        "mass_note": "est.",
        "source": "https://www.infineon.com/cms/en/product/power/mosfet/n-channel/irlml6344/",
        "per_side": 0.5,
    },
]


def simulate(ambient_c: float, bag_volume: float, cartridge_g: float, steel_kg: float, dt: float = 0.005) -> dict:
    """Fill one bladder from one cylinder. Returns time series + key times.

    Cylinder: saturated liquid + vapour, vapour drawn through a choked orifice; evaporation cools the liquid and
    the steel (no heat from outside in the few seconds this takes). Below the triple point the rest freezes to
    dry ice and is counted as residual. Bag: first unfurls at a small gauge pressure, then pressurises at full
    volume; gas enters cold (Joule-Thomson) and the thin wall warms it; the relief valve caps the pressure.

    shortcut: vapour-only draw (the cylinder is mounted neck down, so it really draws liquid: faster, colder);
    replace with bench data before trusting PONT_INF_T (flight/README.md).
    """
    d = DESIGN
    t_amb = ambient_c + 273.15
    v_cyl = cartridge_g / d["cylinder_fill_g_per_ml"] * 1e-6
    area = d["orifice_cd"] * math.pi * (d["orifice_d_mm"] * 1e-3) ** 2 / 4
    m_c, t_c = cartridge_g / 1000, t_amb  # cylinder gas mass and temperature
    m_b, t_b = 1e-6, t_amb  # bag
    v_b = m_b * R_CO2 * t_b / (P_ATM + d["unfold_gauge_kpa"] * 1e3)
    p_unf = d["unfold_gauge_kpa"] * 1e3
    p_rel = d["relief_gauge_kpa"] * 1e3
    p_ok = d["switch_gauge_kpa"] * 1e3
    wall_area = capsule_area(0.18, 0.66)
    t, series, times, vented, frozen = 0.0, [], {}, 0.0, 0.0
    liquid = True
    p_sat_last, rho_last, t_last = p_sat(t_c), rho_vap(t_c), t_c
    while t < 30:
        # cylinder outflow
        if m_c > 0:
            if liquid and m_c <= rho_vap(t_c) * v_cyl:
                liquid = False
                times.setdefault("liquid_gone_s", t)
            if liquid:
                p_c, rho_c = p_sat(t_c), rho_vap(t_c)
            else:  # vapour blowdown, isentropic from the last saturated state
                rho_c = m_c / v_cyl
                p_c = p_sat_last * (rho_c / rho_last) ** GAMMA
                t_c = t_last * (rho_c / rho_last) ** (GAMMA - 1)
            p_bag = P_ATM + (p_unf if v_b < bag_volume else m_b * R_CO2 * t_b / v_b - P_ATM)
            if p_c <= p_bag / 0.55:
                m_flow = 0.0
                frozen = m_c
                m_c = 0
            else:
                m_flow = min(area * choked_flux(p_c, rho_c), m_c / dt)
            if liquid:
                t_c -= latent_heat(t_c) * m_flow * dt / (steel_kg * 490.0 + (m_c - rho_vap(t_c) * v_cyl) * 2500.0)
                p_sat_last, rho_last, t_last = p_sat(t_c), rho_vap(t_c), t_c
                if t_c <= T_TRIPLE:  # rest freezes: dry ice, sublimes over minutes (vented later)
                    frozen = m_c
                    times.setdefault("frozen_s", t)
                    m_c, m_flow = 0.0, 0.0
            m_c -= m_flow * dt
        else:
            m_flow, p_c = 0.0, 0.0
        # bag energy balance (ideal gas), open system: dU = cp T_in dm - p dV + Q
        p_bag_abs = m_b * R_CO2 * t_b / v_b
        t_in = max(t_c - MU_JT * max(p_c - p_bag_abs, 0), 195.0) if m_flow else t_b
        q = d["bag_wall_h_w_m2k"] * wall_area * min(v_b / bag_volume, 1) * (t_amb - t_b)
        u = m_b * CV * t_b + CP * t_in * m_flow * dt + q * dt
        m_b += m_flow * dt
        if v_b < bag_volume:  # unfurling: pressure fixed, volume follows
            p_abs = P_ATM + p_unf
            v_new = m_b * R_CO2 * (u / (m_b * CV)) / p_abs
            u -= p_abs * (v_new - v_b)
            v_b = min(v_new, bag_volume)
        t_b = u / (m_b * CV)
        p_abs = m_b * R_CO2 * t_b / v_b
        if p_abs - P_ATM > p_rel:  # relief valve vents the surplus
            m_keep = (P_ATM + p_rel) * v_b / (R_CO2 * t_b)
            vented += m_b - m_keep
            m_b, p_abs = m_keep, P_ATM + p_rel
        gauge = p_abs - P_ATM if v_b >= bag_volume else p_unf
        t += dt
        if v_b >= bag_volume:
            times.setdefault("full_volume_s", t)
        if v_b >= bag_volume and gauge >= p_ok:
            times.setdefault("pressure_ok_s", t)
        if v_b >= bag_volume and gauge >= d["working_gauge_kpa"] * 1e3:
            times.setdefault("working_pressure_s", t)
        if gauge >= p_rel - 1:
            times.setdefault("relief_opens_s", t)
        if round(t / dt) % 10 == 0:
            series.append((round(t, 3), round(v_b / bag_volume, 4), round(gauge / 1e3, 2), round(t_b - 273.15, 1)))
    return {
        "ambient_c": ambient_c,
        "times_s": {k: round(v, 2) for k, v in times.items()},
        "delivered_g": round((cartridge_g / 1000 - frozen - max(m_c, 0)) * 1000, 1),
        "frozen_residual_g": round(frozen * 1000, 1),
        "vented_g": round(vented * 1000, 1),
        "bag_gas_min_c": round(min(s[3] for s in series), 1),
        "bag_gauge_after_30s_kpa": series[-1][2],
        "series": series,
    }


def main() -> int:
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    idc, req, env = ark["industrial_design"], ark["requirements"], ark["environment"]
    res, pt = idc["result"], idc["pontoon"]
    d = DESIGN
    vol = res["pontoons"]["volume_l_each"] / 1000
    auw = res["auw_estimate_kg"]

    # gas sizing
    m_req = gas_mass(d["working_gauge_kpa"] * 1e3, vol, d["sizing_gas_t_k"]) / (1 - d["cylinder_residual_frac"])
    cart = next(c for c in d["standard_cartridges_g"] if c / 1000 >= m_req * d["cartridge_margin_min"])
    cyl = next(p for p in PARTS if p["role"] == "CO2 cylinder")
    steel = cyl["mass_kg"] - cart / 1000

    sims = {k: simulate(c, vol, cart, steel) for k, c in d["ambient_c"].items()}
    t_ok = max(s["times_s"]["pressure_ok_s"] for s in sims.values())
    t_needed = d["actuation_s"] + t_ok

    # firing height: inflation done with margin, and (planned landing) a pressure verdict above the abort height
    fire_alt = d["land_speed_mps"] * t_needed * d["timing_margin"] + d["abort_alt_m"]
    fire_alt = math.ceil(fire_alt * 2) / 2
    radar_to_skid = res["mounts"]["radar_z_m"] - res["mounts"]["skid_bottom_z_m"]

    # bladder: hoop tension at the relief setting vs fabric
    r = pt["d_m"] / 2
    fab = pt.get("fabric", d["fabric"])  # a variant may name its own tube fabric (Ark-1M: self-sealing liner)
    hoop_n_per_50mm = d["relief_gauge_kpa"] * 1e3 * r * 0.05
    sf_fabric = fab["tensile_n_per_50mm"] / hoop_n_per_50mm
    sf_seam = sf_fabric * fab["seam_efficiency"]
    burst_kpa = fab["tensile_n_per_50mm"] * fab["seam_efficiency"] / 0.05 / r / 1e3
    bladder_kg = capsule_area(pt["d_m"], pt["length_m"]) * (1 + fab["seam_allowance"]) * fab["areal_kg_m2"]
    parts = [
        *PARTS,
        {
            "role": "Bladder",
            "product": f"{fab['name']}, Ø{pt['d_m'] * 1000:.0f} × {pt['length_m'] * 1000:.0f} mm capsule",
            "size_mm": "folds to ≈ 340 × 40 × 45",
            "mass_kg": round(bladder_kg, 3),
            "mass_note": "est.: fabric area × areal mass + seams",
            "source": "",
            "per_side": 1,
        },
    ]
    kit_kg = sum(p["mass_kg"] * p["per_side"] * 2 for p in parts)
    budget = idc["added_mass_kg"]["inflatable_pontoon_kit"]
    auw_new = auw + kit_kg - budget

    # relief valve: must pass the full inflow at the relief pressure (cold gas)
    rho_relief = gas_mass(d["relief_gauge_kpa"] * 1e3, 1.0, 263.0)
    m_in_max = (
        d["orifice_cd"]
        * math.pi
        * (d["orifice_d_mm"] * 1e-3) ** 2
        / 4
        * choked_flux(p_sat(d["ambient_c"]["nominal"] + 273.15), rho_vap(d["ambient_c"]["nominal"] + 273.15))
    )
    relief_port_mm = 2 * math.sqrt(m_in_max / (0.6 * math.sqrt(2 * rho_relief * d["relief_gauge_kpa"] * 1e3)) / math.pi)

    # one side fails: total buoyancy of one tube, and the list it floats at (CG must sit over the one tube)
    rho_w = env["rho_water"]
    tube_y = res["pontoons"]["skid_y_m"] + d["tube_gap_m"] + r
    cg_z = res["battery"]["pack_centre_m"][2]  # heaviest item; the CG sits near it (est.)
    one_side_ratio = vol * rho_w / auw_new
    one_side_list = math.degrees(math.atan2(tube_y, cg_z - res["pontoons"]["tube_centre_z_m"]))

    # firing electronics
    sol_v, sol_ohm, pulse_s = 12.0, 24.0, 0.3  # latch solenoid: 12 V, 24 ohm coil (0.5 A), 300 ms pulse, est.

    out = {
        "note": "Generated by industrial-design/pontoon_system.py from ark.json. 'est.' = engineering estimate.",
        "decisions": [
            (
                "Tubes sit outboard of the skid runner (the runner and legs fill the old tube centre line); "
                "buoyancy and draft are unchanged, the wider track adds roll stability."
            ),
            (
                "No pyrotechnics: a hand-cocked spring pulls the inflator lever when a 12 V latch solenoid releases it. "
                "Re-arm = new cylinder + re-cock, no explosive to store or ship."
            ),
            "One cylinder per side, sides not cross-connected: a puncture on one side cannot drain the other.",
            "Pressure switch tee'd into the inflator outlet reads bag pressure: one 2-wire lead per side.",
            (
                "Firing needs two outputs: ARM (high side, shared) and FIRE (low side, per side). One stuck output "
                "cannot fire a side."
            ),
            (
                "60 g cylinder (not 38 g): the bag gas is cold right after a fast fill; 38 g would not reach working "
                "pressure at -10 C. The relief valve vents the surplus."
            ),
            (
                "Unknown water flag during a battery failsafe counts as water: a wasted cylinder costs less than the "
                "drone."
            ),
        ],
        "geometry": {
            "tube_d_m": pt["d_m"],
            "tube_length_m": pt["length_m"],
            "tube_centre_y_m": round(tube_y, 4),
            "tube_centre_z_m": res["pontoons"]["tube_centre_z_m"],
            "volume_l_each": res["pontoons"]["volume_l_each"],
            "inflator_point_m": [
                0.24,
                round(res["pontoons"]["skid_y_m"] - 0.03, 4),
                round(res["mounts"]["skid_bottom_z_m"] + 0.045, 4),
            ],
            "pack_x_m": [-0.18, 0.18],
            "radar_to_skid_bottom_m": round(radar_to_skid, 4),
        },
        "gas": {
            "working_gauge_kpa": d["working_gauge_kpa"],
            "switch_gauge_kpa": d["switch_gauge_kpa"],
            "relief_gauge_kpa": d["relief_gauge_kpa"],
            "required_g": round(m_req * 1000, 1),
            "required_basis": f"{d['working_gauge_kpa']} kPa gauge at {d['sizing_gas_t_k'] - 273.15:.0f} C in "
            f"{vol * 1000:.1f} L, {d['cylinder_residual_frac']:.0%} left in the cylinder",
            "cartridge_g": cart,
            "cartridge_margin": round(cart / 1000 / m_req, 2),
            "cylinder_p_mpa_at_30c": round(p_sat(303.15) / 1e6, 2),
            "relief_port_min_mm": round(relief_port_mm * 1000, 1),
        },
        "inflation": {
            "model": "choked vapour flow through the pierced seal, evaporative cooling of the liquid + steel, "
            "Joule-Thomson cold gas into the bag, wall heat transfer, relief valve cap (est.)",
            "orifice_d_mm": d["orifice_d_mm"],
            "actuation_s": d["actuation_s"],
            "cases": {k: {kk: vv for kk, vv in s.items() if kk != "series"} for k, s in sims.items()},
            "time_to_pressure_ok_s": round(t_needed, 2),
            "curve": {
                "ambient_c": d["ambient_c"]["nominal"],
                "t_s_vol_gauge_kpa_gas_c": [x for x in sims["nominal"]["series"][::2] if x[0] <= 12],
            },
        },
        "bladder": {
            "fabric": fab["name"],
            "hoop_tension_at_relief_n_per_50mm": round(hoop_n_per_50mm, 0),
            "fabric_strength_n_per_50mm": fab["tensile_n_per_50mm"],
            "safety_factor_fabric": round(sf_fabric, 1),
            "safety_factor_seam": round(sf_seam, 1),
            "burst_gauge_kpa_est": round(burst_kpa, 0),
            "mass_kg_each": round(bladder_kg, 3),
        },
        "firing": {
            "actuator": "12 V latch solenoid releases a hand-cocked 100 N spring that pulls the inflator lever",
            "solenoid_v": sol_v,
            "coil_ohm_est": sol_ohm,
            "pulse_s": pulse_s,
            "current_a": round(sol_v / sol_ohm, 2),
            "energy_j": round(sol_v**2 / sol_ohm * pulse_s, 2),
            "outputs": "Pixhawk 6X FMU (AUX) pins as relays: ARM = RELAY1 (AUX3), FIRE_L = RELAY2 (AUX4), "
            "FIRE_R = RELAY3 (AUX5); pressure switches on AUX6/AUX7 as GPIO inputs, 10 kΩ pull-up to 3.3 V, "
            "switch closes to GND",
            "interlock": "ARM high-side P-FET feeds both solenoids; each FIRE N-FET switches its own return. "
            "Firing needs both. Script only drives ARM while the vehicle is armed and flying; "
            "a remove-before-flight pin locks each spring on the ground.",
            "confirmation": "pressure switch per side (closed = bag ≥ 12 kPa); open circuit reads as 'no pressure'",
        },
        "trigger": {
            "land_speed_mps": d["land_speed_mps"],
            "timing_margin": d["timing_margin"],
            "abort_alt_m": d["abort_alt_m"],
            "fire_alt_m": fire_alt,
            "fire_rule": "fire when skid height ≤ max(PONT_FIRE_ALT, descent rate × PONT_INF_T × PONT_MARGIN + "
            "PONT_ABORT_ALT)",
            "ok_timeout_s": round(2 * t_needed, 1),
            "retry_after_s": round(t_needed + 1.0, 1),
        },
        "mass": {
            "parts": [{k: v for k, v in p.items()} for p in parts],
            "kit_kg": round(kit_kg, 3),
            "budget_kg": budget,
            "over_budget_kg": round(kit_kg - budget, 3),
            "auw_with_kit_kg": round(auw_new, 3),
            "reserve_buoyancy_with_kit": round(2 * vol * rho_w / auw_new - 1, 3),
            "reserve_required": req["reserve_buoyancy_frac"],
        },
        "one_side_failure": {
            "buoyancy_ratio": round(one_side_ratio, 3),
            "floats": one_side_ratio > 1,
            "list_deg_est": round(one_side_list, 0),
            "verdict": "One tube alone still floats the drone, but it lists onto that side until the CG is over "
            "the tube: the low-side props go in the water. Recoverable as an object, not flyable. "
            "So on a planned landing a one-side failure aborts the landing above the abort height.",
        },
    }
    OUT_JSON.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    parm = {
        "SCR_ENABLE": 1,
        "PONT_ENABLE": 1,
        "PONT_FIRE_ALT": fire_alt,
        "PONT_INF_T": round(t_needed, 1),
        "PONT_MARGIN": d["timing_margin"],
        "PONT_ABORT_ALT": d["abort_alt_m"],
        "PONT_OK_TMO": out["trigger"]["ok_timeout_s"],
        "PONT_RETRY_T": out["trigger"]["retry_after_s"],
        "PONT_RNG_OFS": round(radar_to_skid, 2),
        "PONT_PULSE_MS": int(pulse_s * 1000),
    }
    OUT_PARM.parent.mkdir(exist_ok=True)
    OUT_PARM.write_text(
        "# Ark-1 pontoon trigger: generated by industrial-design/pontoon_system.py (do not hand-edit the PONT_ values)\n"
        + "".join(f"{k},{v}\n" for k, v in parm.items())
        + "# outputs: FMU AUX3..5 as relays, AUX6/7 as GPIO inputs (ArduPilot 4.7: RELAYn_FUNCTION / RELAYn_PIN)\n"
        "SERVO11_FUNCTION,-1\nSERVO12_FUNCTION,-1\nSERVO13_FUNCTION,-1\nSERVO14_FUNCTION,-1\nSERVO15_FUNCTION,-1\n"
        "RELAY1_FUNCTION,1\nRELAY1_PIN,52\nRELAY1_DEFAULT,0\n"
        "RELAY2_FUNCTION,1\nRELAY2_PIN,53\nRELAY2_DEFAULT,0\n"
        "RELAY3_FUNCTION,1\nRELAY3_PIN,54\nRELAY3_DEFAULT,0\n"
        "PONT_PS_L_PIN,55\nPONT_PS_R_PIN,56\n"
        "# radar altimeter (Ainstein US-D1) facing down\nRNGFND1_TYPE,11\nRNGFND1_ORIENT,25\nRNGFND1_MAX,50\n",
        encoding="utf-8",
    )
    s = sims["cold"]
    print(
        f"cartridge {cart} g (need {m_req * 1000:.1f} g), pressure OK at {t_needed:.2f} s (cold), fire at {fire_alt} m, "
        f"kit {kit_kg:.3f} kg vs {budget} budget, delivered {s['delivered_g']} g, frozen {s['frozen_residual_g']} g"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

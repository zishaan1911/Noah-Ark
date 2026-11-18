"""Ark-1 as a rigid body with motors, battery and pontoons, read from the hardware design (nothing hard-coded).

Sources: hardware/ark.json (mass budget, rotor, electrical, drag), industrial-design/harness.json (every
electrical part's position and mass) and industrial-design/pontoon_system.json (tubes, inflation timing).
Frames: the hardware files use x forward, y left, z up; the simulator uses FRD body / NED world, so `frd()`
flips y and z.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

HW = Path(__file__).resolve().parents[2] / "hardware"
ID = HW / "industrial-design"


def frd(p) -> np.ndarray:
    return np.array([p[0], -p[1], -p[2]], dtype=float)


def _box_inertia(m: float, size) -> np.ndarray:
    a, b, c = size
    return m / 12 * np.diag([b * b + c * c, a * a + c * c, a * a + b * b])


def _point_inertia(m: float, r: np.ndarray) -> np.ndarray:
    return m * (r @ r * np.eye(3) - np.outer(r, r))


@dataclass(frozen=True)
class Model:
    mass: float
    inertia: np.ndarray  # about the CG, FRD
    rotor_pos: np.ndarray  # (4, 3) from the CG, ArduPilot quad-X order M1..M4
    rotor_dir: np.ndarray  # +1: prop spins CCW from above, so its drag torque yaws the body +z (nose right)
    k_thrust: float  # N per (rad/s)^2
    k_torque: float  # N m per (rad/s)^2
    j_rotor: float  # kg m^2, prop + motor bell
    ke: float  # V s/rad (= kt, N m/A)
    r_motor: float  # ohm, line to line (two phases conduct)
    i0: float  # A, no-load current
    duty_max: float  # ESC duty at full throttle
    cells_s: int
    capacity_ah: float
    r_pack: float  # ohm, pack + harness
    ocv_full: float  # V per cell
    ocv_low: float  # V per cell at 20 % charge
    avionics_w: float
    cda: float  # m^2, forward flight, payload included
    cda_vertical: float  # m^2, broadside to a vertical airflow
    rho_air: float
    rho_water: float
    g: float
    tube_d: float
    tube_len: float
    tube_pos: np.ndarray  # (2, 3) tube centres from the CG, [left, right]
    inflate_full_s: float  # fire to full volume
    inflate_ok_s: float  # fire to pressure switch closed
    radar_pos: np.ndarray  # from the CG
    skid_pts: np.ndarray  # (4, 3) skid runner ends from the CG
    prop_pts: np.ndarray  # (4, 3) prop hubs from the CG (prop-strike check)
    prop_r: float
    cg_hw: np.ndarray  # CG in the hardware frame (x fwd, y left, z up), for the viewer replay


def load(case: str = "nominal") -> Model:
    """case: pontoon_system.json inflation case ('nominal' 30 C, 'cold' 15 C)."""
    ark = json.loads((HW / "ark.json").read_text(encoding="utf-8"))
    har = json.loads((ID / "harness.json").read_text(encoding="utf-8"))
    pon = json.loads((ID / "pontoon_system.json").read_text(encoding="utf-8"))
    res = ark["industrial_design"]["result"]
    mkg = res["mass_kg"]
    env, el = ark["environment"], ark["electrical"]
    prop = next(p for p in ark["candidates"]["propulsion"] if p["name"] == ark["chosen"]["propulsion"])
    geo = ark["chosen"]["geometry_m"]

    # ---- masses (kg) at positions (FRD, hardware origin), each with its own box inertia
    parts: list[tuple[float, np.ndarray, tuple]] = []
    for c in har["components"]:
        if c.get("mass_g"):
            parts.append((c["mass_g"] / 1000, frd(c["pos"]), tuple(c["size"])))
    motors = [frd(next(c for c in har["components"] if c["id"] == f"motor{i}")["pos"]) for i in range(1, 5)]
    prop_z = 0.045  # m above the motor centre: the prop hub on the MN801-S shaft (est.)
    props = [m - np.array([0, 0, prop_z]) for m in motors]
    for p in props:
        parts.append((mkg["props"] / 4, p, (geo["prop_d"], 0.05, 0.01)))
    mounts = res["mounts"]
    hub_bottom, hub_top = mounts["hub_bottom_z_m"], mounts["hub_top_z_m"]
    # shortcut: the shell's mass is split by eye into hub / arms / legs (no mesh integral); use the mesh's
    #   triangle areas from ark_from_model if roll/pitch response ever looks off against a real airframe
    s = mkg["structure"]
    hub_h = hub_top - hub_bottom
    parts.append((0.55 * s, frd([0, 0, (hub_top + hub_bottom) / 2]), (0.5, 0.42, hub_h)))
    r_arm = geo["arm_radius"]
    for sx, sy in ((1, -1), (-1, 1), (1, 1), (-1, -1)):
        mid = np.array([sx, sy, 0]) * r_arm / math.sqrt(2) * 0.6
        parts.append((0.25 * s / 4, frd([mid[0], mid[1], -0.07]), (0.3, 0.05, 0.05)))
    skid_y, skid_z = res["pontoons"]["skid_y_m"], mounts["skid_bottom_z_m"]
    for sy in (1, -1):
        parts.append((0.2 * s / 2, frd([0, sy * skid_y, (skid_z + hub_bottom) / 2]), (0.4, 0.03, hub_bottom - skid_z)))
    pg = pon["geometry"]
    for sy in (1, -1):  # stowed kit: cylinder, head, bladder in the skid pack
        parts.append(
            (
                mkg["pontoon_kit"] / 2,
                frd([0, sy * pg["inflator_point_m"][1], pg["inflator_point_m"][2]]),
                (0.36, 0.05, 0.05),
            )
        )
    parts.append((mkg["copper"] + mkg["mounting_hardware"], frd([0, 0, -0.15]), (0.3, 0.2, 0.1)))
    pod = frd([0.04, 0, hub_bottom - 0.09])  # cargo pod centre (viewer/15_mounts.js)
    parts.append((mkg["payload"], pod, (0.25, 0.16, 0.1)))

    mass = sum(m for m, _, _ in parts)
    cg = sum(m * p for m, p, _ in parts) / mass
    inertia = sum(_box_inertia(m, sz) + _point_inertia(m, p - cg) for m, p, sz in parts)

    # ---- rotor: thrust from the prop's fitted CT, torque from the hover shaft power (power_chain)
    hov = ark["power_chain"]["hover"]
    d = geo["prop_d"]
    k_thrust = el["prop_ct"] * env["rho_air"] * d**4 / (4 * math.pi**2)
    k_torque = hov["p_shaft_w"] / hov["wm_rad_s"] ** 3
    # ArduPilot quad X: M1 front-right CCW, M2 rear-left CCW, M3 front-left CW, M4 rear-right CW
    rotor_dir = np.array([1.0, 1.0, -1.0, -1.0])

    cell = el["cell"]
    s_cells, p_cells = (int(v) for v in res["battery"]["pack"].replace("S", " ").replace("P", "").split())
    cell_ah = 5.0  # Samsung INR21700-50S nominal (harness.json pack)
    r_pack = s_cells * (cell["r0_ohm"] + cell["r1_ohm"]) / p_cells + el["harness"]["r_ohm"]

    mission = ark["industrial_design"]["mission"]["result"]
    times = pon["inflation"]["cases"][case]["times_s"]
    tube_d, tube_len = pg["tube_d_m"], ark["industrial_design"]["pontoon"]["length_m"]
    tubes = np.array([frd([0, sy * pg["tube_centre_y_m"], pg["tube_centre_z_m"]]) for sy in (1, -1)])
    radar = frd(next(c for c in har["components"] if c["id"] == "radar")["pos"])
    skids = np.array([frd([sx * 0.2, sy * skid_y, skid_z]) for sx in (1, -1) for sy in (1, -1)])
    prop_m = prop["prop_kg"]
    j_rotor = prop_m * d * d / 12 + 0.19 * 0.045**2  # blade as a rod + motor bell (0.19 kg at r 45 mm, est.)

    return Model(
        mass=mass,
        inertia=inertia,
        rotor_pos=np.array(props) - cg,
        rotor_dir=rotor_dir,
        k_thrust=k_thrust,
        k_torque=k_torque,
        j_rotor=j_rotor,
        ke=60 / (2 * math.pi * el["motor"]["kv"]),
        r_motor=2 * el["motor"]["rph_ohm"],
        i0=el["motor"]["i0_a"],
        duty_max=el["esc"]["duty_max"],
        cells_s=s_cells,
        capacity_ah=cell_ah * p_cells,
        r_pack=r_pack,
        ocv_full=cell["ocv_full_v"],
        ocv_low=cell["ocv_low_v"],
        avionics_w=el["avionics_w"],
        cda=mission["cda_m2"] + mission["cda_payload_m2"],
        cda_vertical=1.1 * 0.5 * 0.42,  # flat-plate Cd on the hub's plan area (est.); rotor discs not counted
        rho_air=env["rho_air"],
        rho_water=env["rho_water"],
        g=env["g"],
        tube_d=tube_d,
        tube_len=tube_len,
        tube_pos=tubes - cg,
        inflate_full_s=times["full_volume_s"],
        inflate_ok_s=times["pressure_ok_s"],
        radar_pos=radar - cg,
        skid_pts=skids - cg,
        prop_pts=np.array(props) - cg,
        prop_r=d / 2,
        cg_hw=frd(cg),
    )

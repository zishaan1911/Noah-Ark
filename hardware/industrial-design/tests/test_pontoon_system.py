import json
import math
from pathlib import Path

import pytest
from pontoon_system import OUT_JSON, gas_mass, latent_heat, p_sat, rho_vap, simulate

ARK = json.loads((Path(__file__).resolve().parents[2] / "ark.json").read_text(encoding="utf-8"))
PS = json.loads(OUT_JSON.read_text(encoding="utf-8"))


def test_co2_properties_match_tables():
    assert p_sat(273.15) == pytest.approx(3.485e6, rel=0.01)  # NIST: 3.4851 MPa at 0 C
    assert p_sat(293.15) == pytest.approx(5.729e6, rel=0.01)  # 5.7291 MPa at 20 C
    assert p_sat(216.59) == pytest.approx(0.5180e6, rel=0.02)  # triple point
    assert rho_vap(273.15) == pytest.approx(97.6, rel=0.03)
    assert latent_heat(273.15) == pytest.approx(234.5e3)


def test_gas_mass_is_ideal_gas():
    assert gas_mass(0.0, 0.02241, 273.15) == pytest.approx(0.04401, rel=0.002)  # 1 mol CO2 at STP


def test_cartridge_covers_the_cold_fill_with_margin():
    g = PS["gas"]
    assert g["cartridge_g"] / g["required_g"] >= 1.25
    vol = ARK["industrial_design"]["result"]["pontoons"]["volume_l_each"] / 1000
    assert g["required_g"] / 1000 > gas_mass(g["working_gauge_kpa"] * 1e3, vol, 288.0)  # more than a warm fill
    assert g["switch_gauge_kpa"] < g["working_gauge_kpa"] < g["relief_gauge_kpa"]


def test_inflation_fills_then_pressurises_and_the_relief_caps_it():
    vol = ARK["industrial_design"]["result"]["pontoons"]["volume_l_each"] / 1000
    s = simulate(30.0, vol, 60, 0.19)
    t = s["times_s"]
    assert 1.0 < t["full_volume_s"] < t["pressure_ok_s"] < t["working_pressure_s"] < t["relief_opens_s"] < 10
    assert max(x[2] for x in s["series"]) <= PS["gas"]["relief_gauge_kpa"] + 0.01
    vols = [x[1] for x in s["series"]]
    assert vols == sorted(vols) and vols[-1] == pytest.approx(1.0)
    cold = simulate(15.0, vol, 60, 0.19)
    assert cold["times_s"]["pressure_ok_s"] > t["pressure_ok_s"]  # colder cylinder = lower pressure = slower


def test_firing_height_leaves_time_to_inflate_and_to_abort():
    tr, inf = PS["trigger"], PS["inflation"]
    t_ok = inf["time_to_pressure_ok_s"]
    h_at_ok = tr["fire_alt_m"] - tr["land_speed_mps"] * t_ok
    assert h_at_ok >= tr["abort_alt_m"]  # pressure verdict while a planned landing can still be aborted
    assert tr["fire_alt_m"] / tr["land_speed_mps"] >= tr["timing_margin"] * t_ok
    assert tr["retry_after_s"] > t_ok
    assert tr["fire_alt_m"] - tr["land_speed_mps"] * tr["retry_after_s"] > tr["abort_alt_m"]


def test_bladder_strength_and_reserve_with_the_real_kit_mass():
    assert PS["bladder"]["safety_factor_seam"] >= 3
    m = PS["mass"]
    assert m["kit_kg"] == pytest.approx(sum(p["mass_kg"] * p["per_side"] * 2 for p in m["parts"]), abs=1e-3)
    assert m["over_budget_kg"] == pytest.approx(m["kit_kg"] - m["budget_kg"], abs=1e-3)
    assert m["reserve_buoyancy_with_kit"] >= m["reserve_required"]


def test_one_side_floats_but_lists():
    o = PS["one_side_failure"]
    assert o["floats"] and o["buoyancy_ratio"] > 1
    assert 20 < o["list_deg_est"] < 80


def test_tube_clears_the_skid_runner_and_keeps_the_interface_point():
    g = PS["geometry"]
    res = ARK["industrial_design"]["result"]
    assert g["tube_centre_y_m"] - g["tube_d_m"] / 2 > res["pontoons"]["skid_y_m"]
    assert g["inflator_point_m"] == [
        0.24,
        round(res["pontoons"]["skid_y_m"] - 0.03, 4),
        round(res["mounts"]["skid_bottom_z_m"] + 0.045, 4),
    ]
    assert math.isclose(g["tube_centre_z_m"] - g["tube_d_m"] / 2, res["mounts"]["skid_bottom_z_m"], abs_tol=0.002)

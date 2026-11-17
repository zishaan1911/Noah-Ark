import copy
import json
import math

import pytest
from hull import Hull, centre_of_buoyancy, draft_for, hull_for_volume, submerged_volume
from size_ark import ARK_JSON, forward_power, hover_power, induced_forward, search, solve

ARK = json.loads(ARK_JSON.read_text(encoding="utf-8"))


def test_hover_power_matches_hand_calc():
    # 4 rotors x 25 N, A = 0.5 m^2, rho 1.2, ideal: P = 4 * 25^1.5 / sqrt(2 * 1.2 * 0.5) = 456.4 W
    assert hover_power(100, 0.5, 1.0, 1.0, 1.2) == pytest.approx(4 * 25**1.5 / math.sqrt(1.2), rel=1e-9)


def test_forward_inflow_limits():
    assert induced_forward(6.0, 0.0) == pytest.approx(6.0)
    assert induced_forward(6.0, 40.0) == pytest.approx(36 / 40, rel=0.01)  # v_h^2 / V at speed


def test_power_rises_with_weight_and_cruise_beats_hover():
    assert hover_power(130, 0.34, 0.66, 0.8, 1.16) > hover_power(110, 0.34, 0.66, 0.8, 1.16)
    assert forward_power(130, 15, 0.1, 0.34, 0.66, 0.8, 1.16) < hover_power(130, 0.34, 0.66, 0.8, 1.16)


def test_ellipsoid_cap_and_buoyancy():
    h = Hull(0.3, 0.2, 0.1)
    assert submerged_volume(h, 2 * h.c) == pytest.approx(h.volume)
    assert submerged_volume(h, h.c) == pytest.approx(h.volume / 2)
    assert draft_for(h, h.volume / 2) == pytest.approx(h.c, abs=1e-9)
    assert centre_of_buoyancy(h, 2 * h.c) == pytest.approx(h.c)  # full ellipsoid: centroid at the middle
    assert centre_of_buoyancy(h, h.c) == pytest.approx(h.c - 3 * h.c / 8)  # half: 3c/8 below the waterplane
    with pytest.raises(ValueError):
        draft_for(h, h.volume * 1.01)


def test_hull_respects_min_length():
    assert 2 * hull_for_volume(1e-4, 0.7, 0.4, 0.45).a == pytest.approx(0.45)


def test_chosen_config_closes_mission_and_floats():
    feasible = sorted((r for r in search(ARK) if r["feasible"]), key=lambda r: r["mass_kg"]["all_up"])
    best = feasible[0]
    req = ARK["requirements"]
    assert best["energy_wh"]["usable"] >= best["energy_wh"]["needed_with_reserve"]
    assert best["thrust_to_weight"] >= req["twr_min"]
    assert best["float_loaded"]["gm_m"] >= req["gm_min_m"]
    assert best["float_loaded"]["prop_clearance_m"] >= req["prop_clearance_min_m"]
    assert best["propulsion"] == ARK["chosen"]["propulsion"]
    assert best["pack"] == ARK["chosen"]["pack"]  # ark.json is in sync: rerun size_ark.py if this fails


def test_longer_range_needs_more_energy():
    prop, cell = ARK["candidates"]["propulsion"][2], ARK["candidates"]["cells"][1]
    far = copy.deepcopy(ARK)
    far["requirements"]["range_out_km"] = 30
    assert solve(far, prop, cell, 6)["energy_margin"] < solve(ARK, prop, cell, 6)["energy_margin"]

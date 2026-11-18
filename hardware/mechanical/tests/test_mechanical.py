import json
import math

import pytest
from hull import Hull
from mech import ARK_JSON, cantilever_mode_hz, chosen_hull, inner_fits, pack_box, packaging, seals, tube_section

ARK = json.loads(ARK_JSON.read_text(encoding="utf-8"))
MD = ARK["mechanical_design"]


def test_tube_section_hand_calc():
    area, i = tube_section(0.04, 0.002)
    assert area == pytest.approx(math.pi * (0.04**2 - 0.036**2) / 4)
    assert i == pytest.approx(math.pi * (0.04**4 - 0.036**4) / 64)


def test_cantilever_mode_massless_beam():
    # k = 3EI/L^3 = 3 * 1000 / 1 = 3000 N/m, m = 3 kg -> f = sqrt(1000) / 2 pi
    assert cantilever_mode_hz(1000, 1.0, 3.0, 0.0) == pytest.approx(math.sqrt(1000) / (2 * math.pi))


def test_chosen_arm_tube_is_strong_stiff_and_out_of_band():
    arm, lim = MD["arms"], ARK["mechanical"]["arm_limits"]
    lo, hi = arm["rotor_1p_band_hz"]
    assert not lo <= arm["mode_hz"] <= hi
    assert arm["sf"] >= lim["sf_min"]
    assert arm["hover_deflection_m"] <= lim["hover_deflection_max_m"]
    assert arm["tube_mm"] == ARK["chosen"]["arm_tube"]["tube_mm"]  # sizing and mech agree: rerun both if not


def test_inner_fit():
    h = Hull(0.3, 0.2, 0.1)
    assert inner_fits(h, 0.008, [0, 0, 0.1], [0.1, 0.1, 0.05])
    assert not inner_fits(h, 0.008, [0, 0, 0.1], [0.6, 0.1, 0.05])
    assert not inner_fits(h, 0.008, [0, 0, 0.01], [0.1, 0.1, 0.05])  # pokes through the bottom


def test_pack_box_and_packaging_of_chosen():
    assert pack_box(ARK, 12, 6) == pytest.approx([12 * 0.0214 + 0.008, 6 * 0.0214 + 0.008, 0.0705 + 0.008])
    s, p = (int(x) for x in ARK["chosen"]["pack"].removesuffix("P").split("S"))
    pk = packaging(ARK, chosen_hull(ARK), pack_box(ARK, s, p), ARK["chosen"]["mass_kg"]["pack"])
    names = [q["name"] for q in pk["parts"]]
    assert names[0] == "battery" and len(names) == 1 + len(ARK["mechanical"]["internal_parts"])
    assert pk["battery_z_m"] == pytest.approx(ARK["chosen"]["layout_z_m"]["battery_z_m"], abs=1e-3)
    assert pk["skid_bottom_z_m"] < pk["payload_z_m"] < 0 < pk["battery_z_m"]  # skids, then pod, under the hull


def test_seal_and_release():
    sl = seals(ARK, chosen_hull(ARK))
    assert sl["ok"]
    assert 0.15 <= sl["squeeze"] <= 0.3 and sl["fill"] <= 0.85
    assert sl["bolts"] >= math.ceil(sl["oring_length_m"] / ARK["mechanical"]["seal"]["bolt_spacing_max_m"])

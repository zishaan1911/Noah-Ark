import json
import math
from pathlib import Path

import pytest
from ark_from_model import tube_draft, tube_submerged, tube_volume

ARK = json.loads((Path(__file__).resolve().parents[2] / "ark.json").read_text(encoding="utf-8"))
RES = ARK["industrial_design"]["result"]


def test_tube_volume_is_a_capsule():
    assert tube_volume(0.2, 0.2) == pytest.approx(4 / 3 * math.pi * 0.1**3)  # length = diameter: a sphere
    assert tube_volume(0.2, 1.0) == pytest.approx(math.pi * 0.01 * 0.8 + 4 / 3 * math.pi * 0.001)


def test_submerged_volume_limits_and_draft_inverse():
    d, length = 0.18, 0.66
    assert tube_submerged(d, length, d) == pytest.approx(tube_volume(d, length))
    assert tube_submerged(d, length, d / 2) == pytest.approx(tube_volume(d, length) / 2)
    v = 0.4 * tube_volume(d, length)
    assert tube_submerged(d, length, tube_draft(d, length, v)) == pytest.approx(v, rel=1e-6)


def test_stored_design_floats_with_reserve_and_clears_the_water():
    pt = RES["pontoons"]
    assert pt["reserve_buoyancy"] >= ARK["requirements"]["reserve_buoyancy_frac"]
    assert pt["prop_clearance_m"] >= ARK["requirements"]["prop_clearance_min_m"]
    assert pt["hub_clearance_m"] > 0
    assert 0 < pt["draft_m"] < ARK["industrial_design"]["pontoon"]["d_m"]


def test_battery_fits_after_the_housing_stretch():
    b = RES["battery"]
    assert all(b["slot_size_m"][k] + b["housing_stretch_m"][k] >= b["pack_size_m"][k] for k in range(3))
    assert b["grid"][0] * b["grid"][1] >= int(b["pack"].removesuffix("P").split("S")[1]) * 12


def test_gimbal_is_gone():
    assert not any(n.startswith(("GEO_Camera", "GEO_Lens")) for n in RES["kept_parts"])

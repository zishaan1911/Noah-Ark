import json
from pathlib import Path

import numpy as np
import pytest
from mission_check import frontal_area, mission

ARK = json.loads((Path(__file__).resolve().parents[2] / "ark.json").read_text(encoding="utf-8"))


def test_frontal_area_of_a_unit_square_plate():
    # a 0.1 x 0.1 m plate facing x (two triangles in the y-z plane)
    v = np.array([[0, 0, 0], [0, 0.1, 0], [0, 0.1, 0.1], [0, 0, 0.1]], float)
    f = np.array([[0, 1, 2], [0, 2, 3]])
    assert frontal_area(v, f, cell=0.001) == pytest.approx(0.01, rel=0.05)


def test_more_drag_or_mass_needs_more_energy():
    base = mission(ARK, 14.0, 0.15, 0.015, 1000.0)
    assert mission(ARK, 14.0, 0.25, 0.015, 1000.0)["energy_margin"] < base["energy_margin"]
    assert mission(ARK, 16.0, 0.15, 0.015, 1000.0)["energy_margin"] < base["energy_margin"]
    assert mission(ARK, 14.0, 0.15, 0.015, 1200.0)["energy_margin"] > base["energy_margin"]


def test_stored_result_names_a_pack_that_closes_the_mission():
    res = ARK["industrial_design"]["mission"]["result"]
    assert res[res["closes_with"]]["energy_margin"] >= 1.0

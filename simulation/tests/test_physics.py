import json
import math

import numpy as np
import pytest

from ark_sim.model import HW, load
from ark_sim.physics import Sim, World, quat_to_dcm

ARK = json.loads((HW / "ark.json").read_text(encoding="utf-8"))
RES = ARK["industrial_design"]["result"]
M = load()


def test_model_matches_the_hardware_design():
    assert M.mass == pytest.approx(RES["auw_estimate_kg"], abs=0.01)
    hover_w = math.sqrt(M.mass * M.g / 4 / M.k_thrust)
    assert hover_w == pytest.approx(ARK["power_chain"]["hover"]["wm_rad_s"], rel=0.01)
    assert np.all(np.linalg.eigvalsh(M.inertia) > 0)


def test_rests_on_the_pad_with_motors_off():
    s = Sim(M, World())
    for _ in range(1200):
        s.step([1000] * 4, 1 / 1200)
    assert s.p[2] == pytest.approx(-float(np.max(M.skid_pts[:, 2])), abs=0.005)
    assert s.accel_body == pytest.approx([0, 0, -M.g], abs=0.05)


def test_floats_at_the_design_draft_in_calm_water():
    s = Sim(M, World(all_water=True), start_floating=True)
    for _ in range(6000):
        s.step([1000] * 4, 1 / 1200)
    zs, _ = s.world.surface(0, 0, s.t)
    tube_bottom = s.p[2] + M.tube_pos[0, 2] + M.tube_d / 2
    assert tube_bottom - float(zs) == pytest.approx(RES["pontoons"]["draft_m"], abs=0.01)


@pytest.mark.parametrize("deg", [5, 10, 20, 30])
def test_pitch_righting_moment_restores(deg):
    """Phase 5 finding: the 0.66 m tubes lost pitch stability at 25 deg. The 1.0 m tubes must right to 30+."""
    s = Sim(M, World(all_water=True), start_floating=True)
    a = math.radians(deg)
    s.q = np.array([math.cos(a / 2), 0, math.sin(a / 2), 0])
    lo, hi = -1.0, 1.5
    for _ in range(50):  # heave to the equilibrium waterline at this pitch
        s.p[2] = (lo + hi) / 2
        f, _ = s._contacts(quat_to_dcm(s.q))
        lo, hi = (lo, s.p[2]) if -f[2] > M.mass * M.g else (s.p[2], hi)
    _, tq = s._contacts(quat_to_dcm(s.q))
    assert tq[1] < -2.0  # nose-up pitch is pushed back down


def test_json_state_has_what_sitl_requires():
    st = Sim(M, World()).json_state()
    for k in ("timestamp", "position", "attitude", "velocity", "rng_1"):
        assert k in st
    assert set(st["imu"]) == {"gyro", "accel_body"}


def test_pontoon_inflates_on_the_designed_timing():
    s = Sim(M, World())
    s.fire("L")
    while not s.pressure_ok("L"):
        s.step([1000] * 4, 1 / 100)
    assert s.t == pytest.approx(M.inflate_ok_s, abs=0.011)
    assert s.inflation("L") == 1.0 and s.inflation("R") == 0.0

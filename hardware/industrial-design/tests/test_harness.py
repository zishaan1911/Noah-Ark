import copy
import json
from pathlib import Path

import harness as hn
import numpy as np
import pytest

ARK = json.loads((Path(__file__).resolve().parents[2] / "ark.json").read_text(encoding="utf-8"))
H = hn.load()


@pytest.fixture(scope="module")
def shell():
    if not hn.MODEL.exists():
        pytest.skip("out/ark_model.npz not built (run ark_from_model.py)")
    return hn.build_shell()


def test_awg_table_matches_the_standard():
    assert hn.awg_diameter_m(10) == pytest.approx(2.588e-3, rel=1e-3)
    assert hn.awg_area_m2(12) == pytest.approx(3.31e-6, rel=1e-2)


def test_netlist_is_complete_and_consistent():
    assert hn.check_netlist(H) == []


def test_copper_and_connectors_carry_the_design_currents():
    assert hn.check_copper(H, ARK) == []
    cur = hn.design_currents(ARK)
    assert cur["pack_peak"] >= ARK["chosen"]["pack_peak_current_a"]
    main = next(w for w in H["wires"] if w["id"] == "pw_pack_pos")
    assert main["awg"] == 8 and main["current"] == "pack"


def test_a_dangling_port_and_a_thin_wire_are_caught():
    h = copy.deepcopy(H)
    h["wires"] = [w for w in h["wires"] if w["id"] != "telem1_rfd"]
    errs = hn.check_netlist(h)
    assert any("TELEM1" in e for e in errs) and any("rfd.uart" in e for e in errs)
    h = copy.deepcopy(H)
    next(w for w in h["wires"] if w["id"] == "pw_pack_pos")["awg"] = 16
    assert any("pw_pack_pos" in e for e in hn.check_copper(h, ARK))


def test_domain_mismatch_is_caught():
    h = copy.deepcopy(H)
    w = next(w for w in h["wires"] if w["id"] == "jet_power")
    w["to"] = "fc.POWER2"
    assert any("domain" in e for e in hn.check_netlist(h))


def test_pontoon_pin_plan_is_wired_as_agreed():
    ends = {(w["from"], w["to"]) for w in H["wires"]}
    assert ("fc.FMU_PWM_3", "fire.arm_in") in ends
    assert ("fc.FMU_PWM_4", "fire.fire_L_in") in ends and ("fc.FMU_PWM_5", "fire.fire_R_in") in ends
    assert ("fire.out_L", "inflator_L.fire") in ends and ("fire.out_R", "inflator_R.fire") in ends
    assert ("pontoon_L.pressure_ok", "fc.FMU_PWM_6") in ends and ("pontoon_R.pressure_ok", "fc.FMU_PWM_7") in ends


def test_everything_fits_inside_the_shell(shell):
    assert hn.check_fit(H, shell) == []


def test_a_wire_through_the_roof_is_caught(shell):
    h = copy.deepcopy(H)
    w = next(w for w in h["wires"] if w["id"] == "telem1_rfd")
    w["route"] = w["route"][:1] + [[-0.02, 0.06, 0.08], [0.015, 0.075, 0.08]] + w["route"][-1:]
    assert any("telem1_rfd" in e for e in hn.check_fit(h, shell))


def test_cavity_contains_hub_arms_and_legs(shell):
    pts = np.array([[0.0, 0.0, -0.1], [0.3, 0.3, -0.11], [0.214, 0.256, -0.45], [-0.06, 0.0, -0.2]])
    assert shell.inside(pts).all()
    assert not shell.inside(np.array([[0.0, 0.0, 0.1], [0.6, 0.0, -0.1]])).any()


def test_stored_summary_matches_a_fresh_run():
    res = hn.run(H, ARK, None)
    assert H["checks"]["wires"] == res["wires"] == len(H["wires"])
    assert H["checks"]["copper_kg"] == res["copper_kg"]
    assert H["checks"]["ok"]

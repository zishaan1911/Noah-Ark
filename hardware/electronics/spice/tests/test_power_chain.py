import json

import pytest
import spice
from run_spice import ARK_JSON, esc_params, hover_point, pack

ARK = json.loads(ARK_JSON.read_text(encoding="utf-8"))
PC = ARK["power_chain"]


def test_results_match_current_sizing():
    # Rerun run_spice.py if this fails: sizing changed after the power chain was simulated.
    assert PC["hover"]["thrust_n"] == pytest.approx(
        ARK["chosen"]["mass_kg"]["all_up"] * ARK["environment"]["g"] / 4, abs=1e-3
    )


def test_bus_stays_above_cutoff_under_peak():
    for case in PC["bus"].values():
        assert case["vcell_min_peak"] >= case["cutoff_load_v"]


def test_hover_duty_leaves_headroom_and_efficiency_covers_sizing():
    esc = PC["esc_hover_low_pack"]
    assert esc["duty"] <= ARK["electrical"]["esc"]["duty_max"]
    assert esc["efficiency"] >= PC["hover"]["eta_drive_assumed"]


def test_pack_scaling():
    s, p, pk = pack(ARK)
    assert f"{s}S{p}P" == ARK["chosen"]["pack"]
    assert float(pk["rp0"]) == pytest.approx(s * ARK["electrical"]["cell"]["r0_ohm"] / p, rel=1e-4)


def test_hover_point_obeys_thrust_coefficient():
    hp = hover_point(ARK)
    d, rho, ct = ARK["chosen"]["geometry_m"]["prop_d"], ARK["environment"]["rho_air"], ARK["electrical"]["prop_ct"]
    assert ct * rho * (hp["rpm"] / 60) ** 2 * d**4 == pytest.approx(hp["thrust_n"])
    assert hp["p_target_w"] > hp["p_shaft_w"]


@pytest.mark.skipif(spice.ngspice_path() is None, reason="ngspice not installed")
def test_live_esc_run_reproduces_stored_hover():
    # One ngspice run at the stored duty must give the stored shaft power (no sweep, ~8 s).
    stored = PC["esc_hover_low_pack"]
    params, subs = esc_params(ARK, hover_point(ARK), stored["vbus_v"])
    r = spice.run("esc_bldc.cir", "test_esc", params | {"duty": f"{stored['duty']:.5f}"}, subs)
    assert r["pmech"] == pytest.approx(stored["p_mech_w"], rel=0.02)

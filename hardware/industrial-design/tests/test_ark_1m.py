"""Ark-1M (hardware/ark-1m): the stored variant results hang together and still meet Ark-1's rules."""

import json
from pathlib import Path

import pytest
from ark_from_model import box_area, variant_mass
from harness import AMPACITY_A, PEAK_FACTOR, design_currents

HW = Path(__file__).resolve().parents[2]
ARK = json.loads((HW / "ark-1m" / "ark.json").read_text(encoding="utf-8"))
BASE = json.loads((HW / "ark.json").read_text(encoding="utf-8"))
IDC = ARK["industrial_design"]
RES = IDC["result"]
HARNESS = json.loads((HW / "ark-1m" / "industrial-design" / "harness.json").read_text(encoding="utf-8"))
PONTOON = json.loads((HW / "ark-1m" / "industrial-design" / "pontoon_system.json").read_text(encoding="utf-8"))


def test_mass_budget_adds_up_and_carries_the_variant_groups():
    assert sum(RES["mass_kg"].values()) == pytest.approx(RES["auw_estimate_kg"], abs=0.01)
    assert RES["mass_kg"]["payload"] == ARK["requirements"]["payload_kg"] == 4.0
    assert RES["mass_kg"]["armour"] > 0.2 and RES["mass_kg"]["coating"] > 0.05
    assert RES["mass_kg"]["pontoon_kit"] == pytest.approx(PONTOON["mass"]["kit_kg"], abs=0.001)


def test_variant_mass_is_empty_for_ark_1():
    assert variant_mass(BASE["industrial_design"], [0.26, 0.16, 0.08], 1.6) == {}
    assert box_area([1, 1, 1]) == 6


def test_mission_closes_with_thrust_to_spare_on_the_current_mass():
    m = IDC["mission"]["result"]
    pack = RES["battery"]["pack"]
    assert m["auw_kg"] == pytest.approx(RES["auw_estimate_kg"], abs=0.01), "mission_check is stale: re-run it"
    assert m["closes_with"] == pack
    assert m[pack]["energy_margin"] >= 1.0
    assert m[pack]["twr"] >= ARK["requirements"]["twr_min"]


def test_floats_with_its_own_reserve():
    pt = RES["pontoons"]
    assert pt["reserve_buoyancy"] >= ARK["requirements"]["reserve_buoyancy_frac"]
    assert pt["prop_clearance_m"] >= ARK["requirements"]["prop_clearance_min_m"]
    assert PONTOON["gas"]["cartridge_g"] <= 60  # still the standard lifejacket cylinder


def test_power_chain_and_harness_pass_at_the_capped_current():
    assert all(ARK["power_chain"]["checks"].values())
    assert HARNESS["checks"]["errors"] == []
    cap = ARK["electrical"]["mot_bat_curr_max_a"]
    assert design_currents(ARK)["pack_peak"] == pytest.approx(cap)
    plug = HARNESS["connector_ratings"]["AS150U female (pack side)"]
    assert cap < plug["peak_a"]
    main = [w for w in HARNESS["wires"] if w.get("current") == "pack"]
    assert main and all(cap <= PEAK_FACTOR * AMPACITY_A[w["awg"]] for w in main)


def test_low_signature_livery_has_no_logos():
    lv = IDC["livery"]
    assert lv["logos"] is False and lv["scheme"] == "low-signature"
    assert "53039" in IDC["coating"]["topcoat"]


def test_ark_1_is_untouched_by_the_variant():
    assert BASE["requirements"]["payload_kg"] == 2.0
    assert "livery" not in BASE["industrial_design"]
    assert "mot_bat_curr_max_a" not in BASE["electrical"]

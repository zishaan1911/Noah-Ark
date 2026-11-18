"""The stored SITL runs (hardware/ark.json -> simulation.result) must pass and be current with the design.
Re-run them with `python -m ark_sim.scenarios all` in the SITL container (README) when the hardware changes."""

import json

import pytest

from ark_sim.model import HW, load
from ark_sim.scenarios import RESULTS, SCENARIOS

SIM = json.loads((HW / "ark.json").read_text(encoding="utf-8")).get("simulation", {}).get("result", {})


@pytest.mark.parametrize("name", list(SCENARIOS))
def test_scenario_passed_on_the_current_design(name):
    assert name in SIM, f"{name} has not been run"
    r = SIM[name]
    assert r["passed"], r["checks"]
    assert r["model_auw_kg"] == pytest.approx(load().mass, abs=0.001), "stale: the design changed since this run"
    assert (RESULTS / f"{name}.json").exists()

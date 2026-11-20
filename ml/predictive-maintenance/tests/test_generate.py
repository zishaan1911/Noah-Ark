import csv
import gzip
import json
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate as g

SCHEMAS = g.REPO / "shared" / "schemas"


def telemetry_validator():
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    from referencing.jsonschema import DRAFT202012

    registry = referencing.Registry().with_resources(
        (p.name, referencing.Resource.from_contents(json.loads(p.read_text()), default_specification=DRAFT202012))
        for p in SCHEMAS.glob("*.schema.json")
    )
    return jsonschema.Draft202012Validator(
        registry.get_or_retrieve("telemetry.schema.json").value.contents, registry=registry
    )


def test_samples_match_the_telemetry_contract():
    v = telemetry_validator()
    n = 0
    for _d, t, _s, _layer in g.run(days=0.05, seed=3):
        v.validate(t)
        n += 1
    assert n > 50


def hover(kind: str | None, steps: int = 240, rain: float = 0.0) -> list[dict]:
    """A drone hovering 20 min, healthy or with `kind` at full severity on motor 1."""
    fleet = g.Fleet(1, wind_ms=0.0, wind_from_deg=0.0, drones_per_hub=1, storms_enabled=False)
    layer = g.HealthLayer(fleet, 1, random.Random(0))
    d = fleet.drones[0]
    d.phase, d.status = "deliver", "in_flight"
    faults = [g.Fault("x#1", kind, 1, -1e6, 1e4)] if kind else []
    layer.health[d.id] = g.Health(faults)
    layer.rain[d.hub] = [(0.0, 1e9, rain)]
    return [layer.step(d, i * g.DT_S) for i in range(steps)]


def mean(samples: list[dict], f) -> float:
    tail = samples[len(samples) // 2 :]  # after warm-up
    return sum(f(s) for s in tail) / len(tail)


def test_each_fault_moves_its_signal():
    ok = hover(None)
    assert 15 < mean(ok, lambda s: s["motor_c"][0] - s["ambient"]) < 35  # healthy motor runs ~25 K over ambient

    bearing = hover("bearing_wear")
    assert mean(bearing, lambda s: s["motor_c"][0]) > mean(ok, lambda s: s["motor_c"][0]) + 15
    assert mean(bearing, lambda s: s["motor_c"][1]) == pytest.approx(mean(ok, lambda s: s["motor_c"][1]), abs=1)
    assert mean(bearing, lambda s: s["vibe"][2]) > mean(ok, lambda s: s["vibe"][2]) + 8

    prop = hover("prop_damage")
    assert mean(prop, lambda s: s["vibe"][0]) > 3 * mean(ok, lambda s: s["vibe"][0])
    assert mean(prop, lambda s: s["vibe"][2]) == pytest.approx(mean(ok, lambda s: s["vibe"][2]), rel=0.15)

    cell = hover("weak_cell")
    assert mean(cell, lambda s: s["volts"]) < mean(ok, lambda s: s["volts"]) - 2
    assert mean(cell, lambda s: s["pack_c"]) > mean(ok, lambda s: s["pack_c"]) + 2

    wet_ok, wet_leak = hover(None, rain=30), hover("seal_leak", rain=30)
    assert mean(wet_leak, lambda s: s["moist"]) > 0.5 > 10 * mean(wet_ok, lambda s: s["moist"])


def test_remaining_life_counts_down_to_failure(tmp_path, monkeypatch):
    # every drone gets a prop fault that fails 40 min in, so the short run sees it through
    monkeypatch.setattr(g, "schedule", lambda _rng, drone, _end: [g.Fault(f"{drone}#1", "prop_damage", 2, 0, 2400)])
    monkeypatch.setattr(sys, "argv", ["generate", "--days", "0.05", "--out", str(tmp_path)])
    g.main()
    with gzip.open(tmp_path / "telemetry.csv.gz", "rt", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    faulty = [r for r in rows if r["label_fault_id"] and r["droneId"] == rows[0]["droneId"]]
    assert faulty and all(r["label_rul_h"] for r in faulty)
    rul = [float(r["label_rul_h"]) for r in faulty]
    assert rul == sorted(rul, reverse=True) and rul[-1] < 0.05
    assert all(r["label_fault"] == "none" and not r["label_rul_h"] for r in rows if not r["label_fault_id"])
    truth = json.loads((tmp_path / "faults.json").read_text())
    assert truth["drones"][rows[0]["droneId"]][0]["kind"] == "prop_damage"

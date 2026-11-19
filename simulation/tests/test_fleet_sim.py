import json
import re
from pathlib import Path

import pytest

from ark_fleet.ids import ulid
from ark_fleet.network import DROP_POINTS, HUBS
from ark_fleet.sim import Fleet, haversine_km  # energy.py, put on the path by ark_fleet

SCHEMAS = Path(__file__).resolve().parents[2] / "shared" / "schemas"


def validators():
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    from referencing.jsonschema import DRAFT202012

    resources = [
        (p.name, referencing.Resource.from_contents(json.loads(p.read_text()), default_specification=DRAFT202012))
        for p in SCHEMAS.glob("*.schema.json")
    ]
    registry = referencing.Registry().with_resources(resources)

    def make(name: str):
        return jsonschema.Draft202012Validator(
            registry.get_or_retrieve(f"{name}.schema.json").value.contents, registry=registry
        )

    return make("mission"), make("drone"), make("telemetry")


def run(seed: int = 7, minutes: float = 30, dt: float = 5.0):
    fleet = Fleet(seed, wind_ms=3.0, wind_from_deg=90.0)
    events, telemetry = [], []
    t = 0.0
    while t < minutes * 60:
        t += dt
        events += fleet.tick(dt, t)
        telemetry += fleet.telemetry(fleet.iso(t))
    return fleet, events, telemetry


def test_network():
    hubs = {h.name: h for h in HUBS}
    assert len(DROP_POINTS) >= 30
    for p in DROP_POINTS:
        h = hubs[p.hub]
        assert 3 <= haversine_km(h.lat, h.lon, p.lat, p.lon) <= 18, p.name
    assert any(p.water for p in DROP_POINTS)
    fleet = Fleet(1, 0.0, 0.0)
    ids = [d.id for d in fleet.drones]
    assert len(ids) == 24 and len(set(ids)) == 24
    assert all(re.fullmatch(r"ARK-[0-9]{3}", i) for i in ids)


def test_run_delivers_and_validates():
    mission_v, drone_v, telemetry_v = validators()
    fleet, events, telemetry = run()
    assert fleet.stats()["deliveredTotal"] >= 5
    order: dict[str, list[str]] = {}
    for ev in events:
        if ev["kind"] == "mission":
            mission_v.validate(ev["data"])
            assert ev["data"]["payloadKg"] == pytest.approx(sum(p["weightKg"] for p in ev["data"]["payload"]))
            order.setdefault(ev["data"]["id"], []).append(ev["data"]["status"])
        else:
            assert ev["kind"] == "drone"
            drone_v.validate(ev["data"])
            assert ev["data"]["batteryPct"] >= 15
    for rec in fleet.records():
        drone_v.validate(rec)
    for t in telemetry:
        telemetry_v.validate(t)
        assert t["batteryPct"] >= 15
    delivered = [s for s in order.values() if "delivered" in s]
    assert len(delivered) >= 5
    for statuses in delivered:
        assert statuses == ["dispatched", "in_flight", "delivered"]


def test_deterministic():
    first = [run(seed=3, minutes=10)[1][:20] for _ in range(2)]
    assert len(first[0]) == 20
    assert first[0] == first[1]


def test_ulid():
    import random

    assert re.fullmatch(r"[0-9A-HJKMNP-TV-Z]{26}", ulid(random.Random(1), 1_767_225_600_000))

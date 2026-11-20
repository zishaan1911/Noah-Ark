import json
import random
import sys

import numpy as np
import pandas as pd
import pytest

import handler as h
from local import Flights

sys.path.insert(0, str(h.REPO / "simulation"))
from ark_fleet.health import Fault, HealthLayer, sensor_fields
from ark_fleet.sim import Fleet

HAVE_MODEL = h.MODEL_PATH.exists()


def drone_event_validator():
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    from referencing.jsonschema import DRAFT202012

    schemas = h.REPO / "shared" / "schemas"
    registry = referencing.Registry().with_resources(
        (p.name, referencing.Resource.from_contents(json.loads(p.read_text()), default_specification=DRAFT202012))
        for p in schemas.glob("*.schema.json")
    )
    return jsonschema.Draft202012Validator(
        registry.get_or_retrieve("drone-event.schema.json").value.contents, registry=registry
    )


# --- policy, with stub models -----------------------------------------------------------------------------------


class Stub:
    def __init__(self, cls: str, proba: float, score: float, rul: float):
        self.classes_ = np.array(["none", "bearing_wear"])
        self.p = [1 - proba, proba] if cls == "bearing_wear" else [proba, 1 - proba]
        self.score, self.rul = score, rul

    def predict_proba(self, _x):
        return np.array([self.p])

    def score_samples(self, _x):
        return np.array([-self.score])

    def predict(self, _x):
        return np.array([self.rul])


def bundle(cls: str, score: float = 0.0, rul: float = 20.0) -> dict:
    s = Stub(cls, 0.9, score, rul)
    return {"features": ["a"], "classifier": s, "anomaly": s, "rul": s, "anomaly_threshold": 0.5}


FEATS = pd.DataFrame({"a": [1.0]} | {k: [0.0] for k in h.flight_features.__globals__["FEATURES"]})


@pytest.mark.parametrize(
    ("cls", "score", "rul", "state", "fault"),
    [
        ("none", 0.0, 20.0, "ok", "none"),
        ("none", 0.9, 20.0, "watch", "unknown"),  # anomaly only
        ("bearing_wear", 0.0, 20.0, "watch", "bearing_wear"),
        ("bearing_wear", 0.0, 3.0, "ground", "bearing_wear"),  # few hours left
        ("bearing_wear", 0.9, 20.0, "ground", "bearing_wear"),  # classifier and anomaly agree
    ],
)
def test_policy(cls, score, rul, state, fault):
    v = h.verdict(bundle(cls, score, rul), FEATS)
    assert (v["state"], v["fault"]) == (state, fault)


def test_event_id_is_a_ulid():
    a, b = h.event_id(1_700_000_000_000), h.event_id(1_700_000_000_001)
    assert len(a) == 30 and a.startswith("evt_") and a[4:14] < b[4:14]


# --- flight boundaries -----------------------------------------------------------------------------------------


def test_flight_ends_on_disarm_or_new_mission():
    f = Flights()
    t = {"droneId": "ARK-101", "armed": True, "missionId": "msn_A"}
    assert f.feed(t) == [] and f.feed(t) == []
    done = f.feed({"droneId": "ARK-101", "armed": True, "missionId": "msn_B"})
    assert [(d["missionId"], len(d["samples"])) for d in done] == [("msn_A", 2)]
    done = f.feed({"droneId": "ARK-101", "armed": False})
    assert [(d["missionId"], len(d["samples"])) for d in done] == [("msn_B", 1)]
    assert f.feed({"droneId": "ARK-101", "armed": False}) == []


# --- the real models on sim flights ------------------------------------------------------------------------------


def fly(kind: str | None, seconds: float = 4 * 3600) -> list[dict]:
    """Every finished flight of one drone with `kind` near failure on motor 1, through the live telemetry path."""
    fleet = Fleet(7, wind_ms=0.0, wind_from_deg=0.0, storms_enabled=False)
    layer = HealthLayer(fleet.drones, 1, random.Random(0))
    d = fleet.drones[0]
    layer.health[d.id].faults = [Fault("x#1", kind, 1, -1e6, 1e6)] if kind else []  # severity ~0.25 -> ~1 over 1e6 s
    if kind:
        layer.health[d.id].faults[0].onset_s = -9e5  # ~0.8 severity
    flights, out, t = Flights(), [], 0.0
    while t < seconds:
        t += 5.0
        fleet.tick(5.0, t)
        s = layer.step(d, t, 5.0)
        msg = next(m for m in fleet.telemetry(fleet.iso(t)) if m["droneId"] == d.id)
        if s is not None:
            msg |= sensor_fields(s)
        out += flights.feed(msg)
    return out


@pytest.mark.skipif(not HAVE_MODEL, reason="train the model first: ml/predictive-maintenance/train.py")
def test_handler_on_sim_flights():
    v = drone_event_validator()
    healthy = [h.handler(f) for f in fly(None)]
    worn = [h.handler(f) for f in fly("bearing_wear")]
    assert len(worn) >= 3
    assert sum(e is not None for e in healthy) <= len(healthy) // 5  # mostly quiet on a healthy drone
    flagged = [e for e in worn if e is not None]
    assert len(flagged) >= len(worn) - 1
    for e in flagged:
        v.validate(e)
        assert e["health"]["fault"] == "bearing_wear"
    assert any(e["health"]["state"] == "ground" for e in flagged)


@pytest.mark.skipif(not HAVE_MODEL, reason="train the model first: ml/predictive-maintenance/train.py")
def test_ground_verdict_takes_the_drone_out_of_dispatch():
    """The live loop without a broker: fleet -> health sensors -> monitor -> registry -> dispatch."""
    fleet = Fleet(7, wind_ms=0.0, wind_from_deg=0.0, storms_enabled=False)
    layer = HealthLayer(fleet.drones, 1, random.Random(0))
    sick = fleet.drones[0]
    layer.health[sick.id].faults = [Fault("x#1", "bearing_wear", 1, -9e5, 1e6)]
    for d in fleet.drones[1:]:
        layer.health[d.id].faults = []
    flights, t, grounded_at = Flights(), 0.0, None
    while t < 6 * 3600 and grounded_at is None:
        t += 5.0
        fleet.tick(5.0, t)
        samples = {d.id: s for d in fleet.drones if (s := layer.step(d, t, 5.0)) is not None}
        for msg in fleet.telemetry(fleet.iso(t)):
            if (s := samples.get(msg["droneId"])) is not None:
                msg |= sensor_fields(s)
            for flight in flights.feed(msg):
                ev = h.handler(flight)
                if ev and ev["health"]["state"] == "ground":
                    fleet.apply_health(ev["droneId"], ev["health"])
                    if ev["droneId"] == sick.id:
                        grounded_at = t
    assert grounded_at is not None and sick.status == "maintenance"
    t0 = t
    while t < t0 + 600:
        t += 5.0
        fleet.tick(5.0, t)
    assert sick.status == "maintenance" and sick.mission is None  # dispatch skipped it

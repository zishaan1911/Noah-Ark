import random

from test_fleet_sim import validators  # pytest rootdir-relative import (tests/ has no __init__)

from ark_fleet.health import Fault, HealthLayer, sensor_fields
from ark_fleet.sim import REPAIR_S, Fleet

GROUND = {"state": "ground", "fault": "bearing_wear", "rulH": 4.0, "checkedAt": "2026-01-01T00:00:00.000Z"}


def tick(fleet: Fleet, t: float, seconds: float, dt: float = 5.0) -> float:
    end = t + seconds
    while t < end:
        t += dt
        fleet.tick(dt, t)
    return t


def test_grounded_on_the_pad_goes_to_maintenance_and_comes_back():
    _, drone_v, _ = validators()
    fleet = Fleet(7, wind_ms=0.0, wind_from_deg=0.0, storms_enabled=False)
    d = next(d for d in fleet.drones if d.status == "available")
    rec = fleet.apply_health(d.id, GROUND)
    assert rec is not None and rec["status"] == "maintenance" and rec["health"]["state"] == "ground"
    drone_v.validate(rec)

    t = tick(fleet, 0.0, REPAIR_S - 60)
    assert d.status == "maintenance" and d.mission is None  # dispatch never picked it
    tick(fleet, t, 120)
    assert d.status in ("available", "assigned", "in_flight")
    assert d.health is not None and d.health["state"] == "ok"
    assert fleet.repaired == [d.id]


def test_grounded_in_flight_waits_for_landing():
    fleet = Fleet(7, wind_ms=0.0, wind_from_deg=0.0, storms_enabled=False)
    t = 0.0
    while not any(d.status == "in_flight" for d in fleet.drones):
        t = tick(fleet, t, 5)
    d = next(d for d in fleet.drones if d.status == "in_flight")
    fleet.apply_health(d.id, GROUND)
    assert d.status == "in_flight" and d.ground_pending
    while d.status == "in_flight":
        t = tick(fleet, t, 5)
    assert d.status == "maintenance"


def test_watch_only_annotates():
    fleet = Fleet(7, wind_ms=0.0, wind_from_deg=0.0, storms_enabled=False)
    d = fleet.drones[0]
    before = d.status
    fleet.apply_health(d.id, GROUND | {"state": "watch"})
    assert d.status == before and fleet.drone_record(d)["health"]["state"] == "watch"
    assert fleet.apply_health("ARK-999", GROUND) is None


def test_live_telemetry_with_health_sensors_validates_and_wear_is_warped():
    _, _, tele_v = validators()
    fleet = Fleet(7, wind_ms=0.0, wind_from_deg=0.0, storms_enabled=False)
    layer = HealthLayer(fleet.drones, 1, random.Random(0), warp=100.0)
    d = fleet.drones[0]
    # onset at wear-time 0, fails at 2 wear-days = 1728 sim-s at warp 100
    layer.health[d.id].faults = [Fault("x#1", "prop_damage", 1, 0.0, 2 * 86400)]
    t, sent = 0.0, 0
    while t < 1700:
        t += 4.0
        fleet.tick(4.0, t)
        samples = {x.id: s for x in fleet.drones if (s := layer.step(x, t, 4.0)) is not None}
        for msg in fleet.telemetry(fleet.iso(t)):
            if (s := samples.get(msg["droneId"])) is not None:
                tele_v.validate(msg | sensor_fields(s))
                sent += 1
    assert sent > 0
    assert layer.health[d.id].active(1700 * 100).severity(1700 * 100) > 0.9
    layer.repair(d.id, 1700)
    assert layer.health[d.id].active(1701 * 100) is None

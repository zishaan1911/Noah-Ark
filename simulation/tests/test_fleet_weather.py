import json
from pathlib import Path

import pytest
from optimiser import home_key
from routing import Storm

from ark_fleet import weather
from ark_fleet.network import HUBS
from ark_fleet.sim import Fleet
from ark_fleet.weather import DemoStorm, HubWx, calm, conditions_at, fetch_hub_weather, weather_message

SCHEMAS = Path(__file__).resolve().parents[2] / "shared" / "schemas"


def make_validator(name: str):
    jsonschema = pytest.importorskip("jsonschema")
    referencing = pytest.importorskip("referencing")
    from referencing.jsonschema import DRAFT202012

    resources = [
        (p.name, referencing.Resource.from_contents(json.loads(p.read_text()), default_specification=DRAFT202012))
        for p in SCHEMAS.glob("*.schema.json")
    ]
    registry = referencing.Registry().with_resources(resources)
    return jsonschema.Draft202012Validator(
        registry.get_or_retrieve(f"{name}.schema.json").value.contents, registry=registry
    )


def test_conditions_at_storm_over_hub_is_no_go():
    papar = next(h for h in HUBS if h.name == "Papar")
    kk = next(h for h in HUBS if h.name == "Kota Kinabalu")
    wx = [HubWx(h.name, h.lat, h.lon, 2.0, 3.0, 90.0, 0.0) for h in (papar, kk)]
    storm = Storm("storm-9", papar.lat, papar.lon, 6.0, 45.0)
    cond, hubs = conditions_at(wx, [storm])
    by_name = {h["name"]: h for h in hubs}
    assert by_name["Papar"]["call"] == "no_go"
    assert "storm-9" in by_name["Papar"]["reason"]
    assert by_name["Papar"]["rainMmH"] == 45.0
    assert by_name["Kota Kinabalu"]["call"] == "go"
    assert cond.hub_calls[home_key(papar.lat, papar.lon)][0] == "no_go"
    assert cond.hub_calls[home_key(kk.lat, kk.lon)][0] == "go"


def test_weather_message_validates():
    validator = make_validator("weather")
    _, hubs = conditions_at(calm(HUBS, 3.0, 90.0), [DemoStorm().at(0.0)])
    validator.validate(
        weather_message("2026-01-01T00:00:00.000Z", "open-meteo+demo-storm", hubs, [DemoStorm().json(0.0)])
    )
    storm_over = Storm("storm-1", HUBS[0].lat, HUBS[0].lon, 6.0, 45.0)
    _, hubs = conditions_at(calm(HUBS), [storm_over])
    validator.validate(weather_message("2026-01-01T00:00:00.000Z", "open-meteo", hubs, []))


def test_fetch_hub_weather_unreachable(monkeypatch):
    monkeypatch.setattr(weather, "WX_URL", "http://127.0.0.1:9/")
    wx, detail = fetch_hub_weather(HUBS)
    assert detail
    assert len(wx) == len(HUBS)
    assert all(h.wind_ms == 0.0 and h.rain_mm_h == 0.0 for h in wx)


def test_storm_with_fleet_three_hours():
    mission_v = make_validator("mission")
    fleet = Fleet(7, wind_ms=3.0, wind_from_deg=90.0, storms_enabled=True)
    dt, t = 5.0, 0.0
    calls_by_tick: list[dict[str, str]] = []
    missions: dict[str, dict] = {}
    launches: list[tuple[int, str]] = []  # (tick index, origin key)
    while t < 3 * 3600:
        t += dt
        events = fleet.tick(dt, t)
        calls_by_tick.append({k: v[0] for k, v in fleet.conditions.hub_calls.items()})
        for ev in events:
            if ev["kind"] != "mission":
                continue
            m = ev["data"]
            mission_v.validate(m)
            missions[m["id"]] = m
            if m["status"] == "in_flight":
                launches.append((len(calls_by_tick) - 1, home_key(m["origin"]["lat"], m["origin"]["lon"])))
    assert any(m.get("waypoints") for m in missions.values())
    assert any(c == "no_go" for calls in calls_by_tick for c in calls.values())
    for tick, key in launches:
        # assigned and launched in the same tick, on the calls computed at the start of that tick
        assert calls_by_tick[tick][key] != "no_go"
    stats = fleet.stats()
    assert "held" in stats
    assert set(stats["weatherCalls"]) == {"go", "caution", "no_go"}
    assert stats["deliveredTotal"] > 0

import pytest

from handler import handler


def make_event():
    return {
        "orders": [
            {
                "id": "ord_1",
                "mode": "gdex",
                "destLat": 0.05,
                "destLon": 0.0,
                "payloadKg": 1.0,
                "urgency": 2,
                "createdS": 0,
            }
        ],
        "drones": [
            {
                "id": "ARK-001",
                "lat": 0.0,
                "lon": 0.0,
                "homeLat": 0.0,
                "homeLon": 0.0,
                "status": "available",
                "batteryPct": 90,
                "maxPayloadKg": 2,
            }
        ],
        "wind": {"ms": 2, "fromDeg": 90},
        "nowS": 60,
    }


def test_valid_event(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    out = handler(make_event(), None)
    assert len(out["assignments"]) == 1
    a = out["assignments"][0]
    assert a["orderId"] == "ord_1" and a["droneId"] == "ARK-001"
    assert "ARK-001" in a["aiRationale"]


def test_weather_produces_route(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    event = make_event()
    event["orders"][0]["destLat"] = 0.1
    event["weather"] = {
        "hubs": [{"lat": 0.0, "lon": 0.0, "call": "go", "reason": ""}],
        "storms": [{"id": "storm-1", "lat": 0.05, "lon": 0.0, "radiusKm": 2.0, "rainMmH": 40}],
    }
    a = handler(event, None)["assignments"][0]
    assert len(a["route"]) >= 1
    assert set(a["route"][0]) == {"lat", "lon"}
    assert handler(make_event(), None)["assignments"][0]["route"] == []


def test_missing_dest_lat_raises():
    event = make_event()
    del event["orders"][0]["destLat"]
    with pytest.raises(ValueError, match="destLat"):
        handler(event, None)

import math

import pytest
from test_fleet_sim import validators

from ark_fleet.sim import Fleet

SOS_ID = "sos_01JDZ7Q4X9K2M5N8P3R6T0V1WY"


def request(**over):
    req = {
        "destination": {"lat": 6.42, "lon": 116.34},
        "payload": [
            {"item": "Water purification tablets", "qty": 2, "weightKg": 0.5},
            {"item": "First-aid kit", "qty": 1, "weightKg": 1.0},
        ],
        "mode": "relief",
        "urgency": 5,
        "landingType": "water",
        "sosRequestIds": [SOS_ID],
    }
    return req | over


def quiet_fleet() -> Fleet:
    fleet = Fleet(7, wind_ms=3.0, wind_from_deg=90.0)
    fleet._next_order_s = math.inf  # no random orders, so the SOS order is the only one
    return fleet


def test_sos_order_becomes_a_mission():
    mission_v = validators()[0]
    fleet = quiet_fleet()
    order = fleet.add_request(request(), 0.0)
    assert order is not None
    assert order.urgency == 5 and order.payload_kg == 1.5 and len(fleet.queue) == 1
    events, t = [], 0.0
    for _ in range(3):
        t += 1.0
        events += fleet.tick(1.0, t)
    missions = [e["data"] for e in events if e["kind"] == "mission" and e["data"].get("sosRequestIds") == [SOS_ID]]
    assert missions
    m = missions[0]
    assert m["mode"] == "relief" and m["landingType"] == "water"
    assert m["payload"] == [
        {"item": "Water purification tablets", "qty": 2, "weightKg": 0.5},
        {"item": "First-aid kit", "qty": 1, "weightKg": 1.0},
    ]
    assert m["payloadKg"] == 1.5
    mission_v.validate(m)


@pytest.mark.parametrize(
    "bad",
    [
        {"payload": [{"item": "Heavy crate", "qty": 1, "weightKg": 2.5}]},
        {"payload": []},
        {"destination": None},
        {"destination": "6.42,116.34"},
    ],
)
def test_invalid_requests_are_rejected(bad):
    fleet = quiet_fleet()
    req = request(**bad)
    if bad.get("destination") is None and "destination" in bad:
        del req["destination"]
    assert fleet.add_request(req, 0.0) is None
    assert len(fleet.queue) == 0

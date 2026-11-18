from ark_contracts import Geo, Mission
from pymavlink import mavutil

from flight_bridge.mission import reverse, to_items

M = mavutil.mavlink
HOME = Geo(lat=4.6012, lon=101.0777)


def make_mission() -> Mission:
    return Mission.model_validate(
        {
            "id": "msn_01JD8X5Q2M9VTRC3B7K4N6P0WY",
            "mode": "gdex",
            "droneId": "ARK-001",
            "createdAt": "2026-11-18T09:31:10Z",
            "status": "approved",
            "origin": {"lat": 4.6012, "lon": 101.0777},
            "destination": {"lat": 4.5975, "lon": 101.0901},
            "waypoints": [
                {"lat": 4.6001, "lon": 101.0800, "altM": 50},
                {"lat": 4.5990, "lon": 101.0840, "altM": 60},
                {"lat": 4.5980, "lon": 101.0880, "altM": 55},
            ],
            "landingType": "ground",
            "payload": [{"item": "Parcel", "qty": 1, "weightKg": 1.0}],
            "payloadKg": 1.0,
        }
    )


def test_to_items():
    m = make_mission()
    items = to_items(m, HOME)
    assert len(items) == 1 + 1 + 3 + 1
    assert [i.seq for i in items] == list(range(6))
    assert items[1].command == M.MAV_CMD_NAV_TAKEOFF and items[1].z == 50
    assert items[-1].command == M.MAV_CMD_NAV_LAND
    assert (items[-1].x_lat_e7, items[-1].y_lon_e7) == (round(4.5975e7), round(101.0901e7))
    assert all(i.frame == M.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT for i in items[1:])
    assert all(isinstance(i.x_lat_e7, int) and isinstance(i.y_lon_e7, int) for i in items)


def test_reverse_ends_at_home():
    items = reverse(make_mission(), HOME)
    assert len(items) == 6
    assert items[1].z == 55  # climbs to the last outbound waypoint's height
    assert items[-1].command == M.MAV_CMD_NAV_LAND
    assert (items[-1].x_lat_e7, items[-1].y_lon_e7) == (round(4.6012e7), round(101.0777e7))

"""Mission -> MAVLink mission items. Pure functions, no I/O."""

from __future__ import annotations

from dataclasses import dataclass

from ark_contracts import Geo, Mission
from pymavlink import mavutil

M = mavutil.mavlink
DEFAULT_TAKEOFF_M = 40.0


@dataclass(frozen=True)
class Item:
    seq: int
    frame: int
    command: int
    current: int
    autocontinue: int
    p1: float
    p2: float
    p3: float
    p4: float
    x_lat_e7: int
    y_lon_e7: int
    z: float


def _item(seq: int, command: int, g: Geo, z: float, frame: int = M.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT) -> Item:
    return Item(seq, frame, command, 0, 1, 0, 0, 0, 0, round(g.lat * 1e7), round(g.lon * 1e7), z)


def _build(home: Geo, waypoints: list[Geo], land_at: Geo) -> list[Item]:
    climb = waypoints[0].altM if waypoints and waypoints[0].altM is not None else DEFAULT_TAKEOFF_M
    items = [
        _item(0, M.MAV_CMD_NAV_WAYPOINT, home, home.altM or 0.0, M.MAV_FRAME_GLOBAL_INT),  # ArduPilot overwrites it
        _item(1, M.MAV_CMD_NAV_TAKEOFF, home, climb),
    ]
    for w in waypoints:
        items.append(_item(len(items), M.MAV_CMD_NAV_WAYPOINT, w, w.altM if w.altM is not None else climb))
    items.append(_item(len(items), M.MAV_CMD_NAV_LAND, land_at, 0.0))
    return items


def to_items(mission: Mission, home: Geo) -> list[Item]:
    """Outbound leg: home, takeoff, the waypoints, land at the destination."""
    return _build(home, list(mission.waypoints or []), mission.destination)


def reverse(mission: Mission, home: Geo) -> list[Item]:
    """Return leg: takeoff, the waypoints backwards, land at home."""
    return _build(home, list(reversed(mission.waypoints or [])), home)

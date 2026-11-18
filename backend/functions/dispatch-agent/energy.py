"""Ark-1 energy model: how much battery a delivery trip costs."""

from __future__ import annotations

import math
from dataclasses import dataclass

# Ark-1 as built (hardware/ark.json industrial_design: 16.19 kg AUW, 12S7P), powers from sizing/size_ark.py's
# best_cruise and hover_power on the airframe's own drag (CdA 0.166 m^2 + payload pod 0.014 m^2).
CRUISE_AIRSPEED_MS = 17.0
P_CRUISE_LOADED_W = 1466.7  # 2 kg payload out
P_CRUISE_EMPTY_W = 1241.5  # back, empty
P_HOVER_LOADED_W = 1572.6
P_HOVER_EMPTY_W = 1290.5
PACK_WH = 1512.0
USABLE_WH = 1360.8
RESERVE_PCT = 20.0  # battery % that must remain on landing
HOVER_S_PER_LEG = 60.0  # take-off, climb, descent and landing per leg
DELIVERY_HOVER_S = 30.0
MAX_ONE_WAY_KM = 20.0
MAX_PAYLOAD_KG = 2.0  # payload at which the "loaded" powers apply
MIN_GROUND_SPEED_MS = 3.0

_EARTH_RADIUS_KM = 6371.0088


@dataclass(frozen=True)
class Trip:
    """Cost of drone -> destination -> home."""

    out_km: float
    back_km: float
    out_min: float
    total_min: float
    battery_used_pct: float


def haversine_km(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Great-circle distance in km."""
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = p2 - p1
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    """Initial bearing from a to b, 0..360."""
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def wind_along_ms(track_deg: float, wind_ms: float, wind_from_deg: float) -> float:
    """Wind component along the track: positive is a tailwind. Wind FROM a direction blows toward from+180."""
    return wind_ms * math.cos(math.radians(wind_from_deg + 180.0 - track_deg))


def ground_speed_ms(track_deg: float, wind_ms: float, wind_from_deg: float) -> float:
    """Airspeed plus the along-track wind, never below 3 m/s."""
    return max(MIN_GROUND_SPEED_MS, CRUISE_AIRSPEED_MS + wind_along_ms(track_deg, wind_ms, wind_from_deg))


def _lerp_payload(empty: float, loaded: float, payload_kg: float) -> float:
    frac = min(1.0, max(0.0, payload_kg / MAX_PAYLOAD_KG))
    return empty + (loaded - empty) * frac


def cruise_w(payload_kg: float) -> float:
    """Electrical power in cruise at 17 m/s airspeed."""
    return _lerp_payload(P_CRUISE_EMPTY_W, P_CRUISE_LOADED_W, payload_kg)


def hover_w(payload_kg: float) -> float:
    """Electrical power in hover, climb and descent."""
    return _lerp_payload(P_HOVER_EMPTY_W, P_HOVER_LOADED_W, payload_kg)


def _flight_s(distance_km: float, track_deg: float, wind_ms: float, wind_from_deg: float) -> float:
    return distance_km * 1000.0 / ground_speed_ms(track_deg, wind_ms, wind_from_deg)


def leg_wh(distance_km: float, track_deg: float, wind_ms: float, wind_from_deg: float, payload_kg: float) -> float:
    """Energy for one leg: cruise at ground speed plus the take-off/landing hover."""
    cruise_s = _flight_s(distance_km, track_deg, wind_ms, wind_from_deg)
    return (cruise_w(payload_kg) * cruise_s + hover_w(payload_kg) * HOVER_S_PER_LEG) / 3600.0


def pct(wh: float) -> float:
    """Watt-hours as a percentage of the full pack."""
    return wh / PACK_WH * 100.0


def trip(
    drone_lat: float,
    drone_lon: float,
    dest_lat: float,
    dest_lon: float,
    home_lat: float,
    home_lon: float,
    payload_kg: float,
    wind_ms: float,
    wind_from_deg: float,
) -> Trip:
    """Drone to destination loaded, delivery hover, then destination to home empty."""
    out_km = haversine_km(drone_lat, drone_lon, dest_lat, dest_lon)
    back_km = haversine_km(dest_lat, dest_lon, home_lat, home_lon)
    out_track = bearing_deg(drone_lat, drone_lon, dest_lat, dest_lon)
    back_track = bearing_deg(dest_lat, dest_lon, home_lat, home_lon)

    out_wh = leg_wh(out_km, out_track, wind_ms, wind_from_deg, payload_kg)
    back_wh = leg_wh(back_km, back_track, wind_ms, wind_from_deg, 0.0)
    delivery_wh = hover_w(payload_kg) * DELIVERY_HOVER_S / 3600.0

    out_s = _flight_s(out_km, out_track, wind_ms, wind_from_deg) + HOVER_S_PER_LEG
    back_s = _flight_s(back_km, back_track, wind_ms, wind_from_deg) + HOVER_S_PER_LEG
    return Trip(
        out_km=out_km,
        back_km=back_km,
        out_min=out_s / 60.0,
        total_min=(out_s + DELIVERY_HOVER_S + back_s) / 60.0,
        battery_used_pct=pct(out_wh + delivery_wh + back_wh),
    )

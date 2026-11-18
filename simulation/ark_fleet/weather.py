"""Flying weather for the fleet sim: real Open-Meteo conditions per hub plus a moving demo storm cell."""

from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from energy import haversine_km
from optimiser import Conditions, home_key
from routing import Storm
from weather import fly_call  # the dispatcher's weather module (backend/functions/dispatch-agent), not this file

WX_URL = "https://api.open-meteo.com/v1/forecast"
WX_CURRENT = "wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code"
KM_PER_DEG = 111.19

STORM_ID = "storm-1"
# The cell comes in off the sea SW of Beaufort and runs up the coast over Beaufort, Papar and Kota Kinabalu,
# so each of those hubs goes on hold in turn and routes between them bend around it.
STORM_START = (5.335, 115.738)  # just SW of Beaufort: a viewer sees a hub on hold at once
STORM_END = (6.15, 116.25)
STORM_RADIUS_KM = 4.0  # a mature convective cell; big enough to close a hub, small enough to fly around
STORM_RAIN_MM_H = 45.0
STORM_TO_DEG = 27.0
STORM_SPEED_MS = 10.0
STORM_LIFE_S = 2.5 * 3600.0


@dataclass(frozen=True)
class HubWx:
    name: str
    lat: float
    lon: float
    wind_ms: float
    gust_ms: float
    wind_from_deg: float
    rain_mm_h: float
    weather_code: int | None = None


def calm(hubs: Sequence[Any], wind_ms: float = 0.0, wind_from_deg: float = 0.0) -> list[HubWx]:
    """Dry air for every hub; gust 1.5x the wind."""
    return [HubWx(h.name, h.lat, h.lon, wind_ms, round(wind_ms * 1.5, 1), wind_from_deg, 0.0) for h in hubs]


def fetch_hub_weather(hubs: Sequence[Any]) -> tuple[list[HubWx], str | None]:
    """One Open-Meteo request for every hub: (weather per hub, error detail or None); calm and dry on any failure."""
    query = urllib.parse.urlencode(
        {
            "latitude": ",".join(str(h.lat) for h in hubs),
            "longitude": ",".join(str(h.lon) for h in hubs),
            "current": WX_CURRENT,
            "wind_speed_unit": "ms",
        },
        safe=",",
    )
    try:
        with urllib.request.urlopen(f"{WX_URL}?{query}", timeout=10) as r:
            body = json.load(r)
        rows = body if isinstance(body, list) else [body]  # one location comes back as a bare object
        if len(rows) != len(hubs):
            raise ValueError(f"expected {len(hubs)} locations, got {len(rows)}")
        out = []
        for h, row in zip(hubs, rows, strict=True):
            c = row["current"]
            code = c.get("weather_code")
            out.append(
                HubWx(
                    h.name,
                    h.lat,
                    h.lon,
                    float(c["wind_speed_10m"]),
                    float(c.get("wind_gusts_10m") or c["wind_speed_10m"]),
                    float(c["wind_direction_10m"]),
                    float(c.get("precipitation") or 0.0),
                    None if code is None else int(code),
                )
            )
        return out, None
    except Exception as e:  # noqa: BLE001 (any network or format failure means calm, dry air)
        return calm(hubs), f"weather unavailable, calm dry air: {e}"


class DemoStorm:
    """A storm cell drifting NE across the Crocker range foothills in SIM time, restarting from the sea.

    shortcut: a scripted cell so the demo always has weather to route around; a radar-derived cell tracker
    (e.g. MET Malaysia nowcast) would replace it.
    """

    id = STORM_ID
    radius_km = STORM_RADIUS_KM
    rain_mm_h = STORM_RAIN_MM_H
    moving_to_deg = STORM_TO_DEG
    speed_ms = STORM_SPEED_MS
    thunder = True

    def position(self, t_s: float) -> tuple[float, float]:
        elapsed = t_s % STORM_LIFE_S
        km = self.speed_ms * elapsed / 1000
        r = math.radians(self.moving_to_deg)
        lat = STORM_START[0] + km * math.cos(r) / KM_PER_DEG
        lon = STORM_START[1] + km * math.sin(r) / (KM_PER_DEG * math.cos(math.radians(lat)))
        if lat > STORM_END[0] or lon > STORM_END[1]:  # past the far corner: restart
            return STORM_START
        return lat, lon

    def at(self, t_s: float) -> Storm:
        lat, lon = self.position(t_s)
        return Storm(self.id, lat, lon, self.radius_km, self.rain_mm_h)

    def json(self, t_s: float) -> dict[str, Any]:
        lat, lon = self.position(t_s)
        return {
            "id": self.id,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "radiusKm": self.radius_km,
            "rainMmH": self.rain_mm_h,
            "movingToDeg": self.moving_to_deg,
            "speedMs": self.speed_ms,
            "thunder": self.thunder,
        }


def _over(storm: Storm, lat: float, lon: float) -> bool:
    return haversine_km(storm.lat, storm.lon, lat, lon) <= storm.radius_km


def conditions_at(hubs_wx: Sequence[HubWx], storms: Sequence[Storm]) -> tuple[Conditions, list[dict[str, Any]]]:
    """Per-hub fly calls for the dispatcher and the `hubs` list of the weather message."""
    calls: dict[str, tuple[str, str]] = {}
    hubs: list[dict[str, Any]] = []
    for h in hubs_wx:
        rain = h.rain_mm_h
        call, reason = fly_call(h.wind_ms, h.gust_ms, rain, h.weather_code)
        over = next((s for s in storms if _over(s, h.lat, h.lon)), None)
        if over is not None:
            rain = max(rain, over.rain_mm_h)
            call, reason = "no_go", f"Storm {over.id} over the hub ({over.rain_mm_h:.0f} mm/h)"
        calls[home_key(h.lat, h.lon)] = (call, reason)
        row: dict[str, Any] = {
            "name": h.name,
            "lat": h.lat,
            "lon": h.lon,
            "windMs": round(h.wind_ms, 1),
            "gustMs": round(h.gust_ms, 1),
            "windFromDeg": round(h.wind_from_deg, 1),
            "rainMmH": round(rain, 1),
            "call": call,
        }
        if h.weather_code is not None:
            row["weatherCode"] = h.weather_code
        if reason:
            row["reason"] = reason
        hubs.append(row)
    return Conditions(storms=tuple(storms), hub_calls=calls), hubs


def weather_message(
    now_iso: str, source: str, hubs_json: list[dict[str, Any]], storms: list[dict[str, Any]]
) -> dict[str, Any]:
    """The retained `fleet/weather` payload (shared/schemas/weather.schema.json)."""
    return {"updatedAt": now_iso, "source": source, "hubs": hubs_json, "storms": storms}

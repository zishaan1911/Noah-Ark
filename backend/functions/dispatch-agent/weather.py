"""Ark-1 flying limits and the go / caution / no-go call for a hub."""

from __future__ import annotations

# Ark-1 limits: estimates from the airframe (17 m/s cruise, sealed shell), not flight-tested numbers.
NO_GO_WIND_MS = 12.0
NO_GO_GUST_MS = 15.0
NO_GO_RAIN_MMH = 30.0
CAUTION_WIND_MS = 8.0
CAUTION_GUST_MS = 11.0
CAUTION_RAIN_MMH = 10.0
CAUTION_MAX_ONE_WAY_KM = 15.0  # caution shortens the range
THUNDER_CODES = range(95, 100)  # WMO 95-99


def _worst(hits: list[tuple[float, str]]) -> str:
    """Reason of the hit furthest over its limit (value / limit)."""
    return max(hits, key=lambda h: h[0])[1]


def _hits(wind_ms: float, gust_ms: float, rain_mm_h: float, wind_lim: float, gust_lim: float, rain_lim: float):
    hits: list[tuple[float, str]] = []
    if wind_ms >= wind_lim:
        hits.append((wind_ms / wind_lim, f"Wind {wind_ms:.1f} m/s (limit {wind_lim:g})"))
    if gust_ms >= gust_lim:
        hits.append((gust_ms / gust_lim, f"Gusts {gust_ms:.1f} m/s (limit {gust_lim:g})"))
    if rain_mm_h >= rain_lim:
        hits.append((rain_mm_h / rain_lim, f"Rain {rain_mm_h:.0f} mm/h (limit {rain_lim:g})"))
    return hits


def fly_call(wind_ms: float, gust_ms: float, rain_mm_h: float, weather_code: int | None = None) -> tuple[str, str]:
    """('go' | 'caution' | 'no_go', short reason). 'go' returns ('go', '')."""
    if weather_code in THUNDER_CODES:
        return "no_go", f"Thunderstorm (WMO code {weather_code})"
    hits = _hits(wind_ms, gust_ms, rain_mm_h, NO_GO_WIND_MS, NO_GO_GUST_MS, NO_GO_RAIN_MMH)
    if hits:
        return "no_go", _worst(hits)
    hits = _hits(wind_ms, gust_ms, rain_mm_h, CAUTION_WIND_MS, CAUTION_GUST_MS, CAUTION_RAIN_MMH)
    if hits:
        return "caution", _worst(hits)
    return "go", ""

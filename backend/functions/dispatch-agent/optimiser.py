"""Pick which drone flies each order. Imported directly by the fleet simulator: keep signatures stable."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from energy import MAX_ONE_WAY_KM, RESERVE_PCT, Trip, bearing_deg, trip, wind_along_ms

TIE_MIN = 0.5


@dataclass(frozen=True)
class DroneState:
    id: str
    lat: float
    lon: float
    home_lat: float
    home_lon: float
    status: str  # DroneStatus enum value from drone.schema.json
    battery_pct: float
    max_payload_kg: float


@dataclass(frozen=True)
class Order:
    id: str  # opaque, e.g. "ord_17"
    mode: str  # "gdex" | "relief" | "military"
    dest_lat: float
    dest_lon: float
    payload_kg: float
    urgency: int  # 1..5, 5 is life-threatening; GDEX parcels are 1 or 2
    created_s: float  # seconds, any monotonic clock


@dataclass(frozen=True)
class Choice:
    order_id: str
    drone_id: str
    eta_min: float  # drone to destination
    trip: Trip
    battery_after_pct: float
    runner_up: str | None  # next best drone id
    rationale: str  # one or two plain-English sentences, <= 400 chars


def _trip_for(order: Order, drone: DroneState, wind_ms: float, wind_from_deg: float) -> Trip:
    return trip(
        drone.lat,
        drone.lon,
        order.dest_lat,
        order.dest_lon,
        drone.home_lat,
        drone.home_lon,
        order.payload_kg,
        wind_ms,
        wind_from_deg,
    )


def _wind_phrase(order: Order, drone: DroneState, wind_ms: float, wind_from_deg: float) -> str:
    track = bearing_deg(drone.lat, drone.lon, order.dest_lat, order.dest_lon)
    along = wind_along_ms(track, wind_ms, wind_from_deg)
    if abs(along) < 1.0:
        return "a crosswind"
    return f"a {abs(along):.1f} m/s {'tailwind' if along > 0 else 'headwind'}"


def _rationale(
    drone: DroneState,
    t: Trip,
    after_pct: float,
    wind: str,
    runner: tuple[DroneState, Trip] | None,
) -> str:
    text = (
        f"{drone.id} is {t.out_km:.1f} km away with {drone.battery_pct:.0f}% battery and {wind}: "
        f"{t.out_min:.0f} min to the drop, lands home with {after_pct:.0f}%."
    )
    if runner is not None:
        text += f" Next best {runner[0].id} ({runner[1].out_min:.0f} min)."
    return text[:400]


def choose_drone(order: Order, drones: Sequence[DroneState], wind_ms: float, wind_from_deg: float) -> Choice | None:
    """Fastest eligible drone; ties within 0.5 min go to the higher battery."""
    eligible: list[tuple[DroneState, Trip]] = []
    for d in drones:
        if d.status != "available" or order.payload_kg > d.max_payload_kg:
            continue
        t = _trip_for(order, d, wind_ms, wind_from_deg)
        if t.out_km > MAX_ONE_WAY_KM or d.battery_pct - t.battery_used_pct < RESERVE_PCT:
            continue
        eligible.append((d, t))
    if not eligible:
        return None

    eligible.sort(key=lambda p: p[1].out_min)
    fastest = eligible[0][1].out_min
    best = max((p for p in eligible if p[1].out_min <= fastest + TIE_MIN), key=lambda p: p[0].battery_pct)
    rest = [p for p in eligible if p is not best]
    runner = rest[0] if rest else None

    drone, t = best
    after = drone.battery_pct - t.battery_used_pct
    wind = _wind_phrase(order, drone, wind_ms, wind_from_deg)
    return Choice(
        order_id=order.id,
        drone_id=drone.id,
        eta_min=t.out_min,
        trip=t,
        battery_after_pct=after,
        runner_up=runner[0].id if runner else None,
        rationale=_rationale(drone, t, after, wind, runner),
    )


def assign(
    orders: Sequence[Order],
    drones: Sequence[DroneState],
    wind_ms: float,
    wind_from_deg: float,
    now_s: float,
) -> list[Choice]:
    """Serve orders by priority (urgency first, then wait time); each drone is used once."""
    # shortcut: greedy per-order pick, upgrade to a joint assignment / VRP solver past ~50 drones.
    ranked = sorted(orders, key=lambda o: o.urgency * 10 + (now_s - o.created_s) / 60.0, reverse=True)
    pool = list(drones)
    out: list[Choice] = []
    for order in ranked:
        choice = choose_drone(order, pool, wind_ms, wind_from_deg)
        if choice is None:
            continue
        out.append(choice)
        pool = [d for d in pool if d.id != choice.drone_id]
    return out

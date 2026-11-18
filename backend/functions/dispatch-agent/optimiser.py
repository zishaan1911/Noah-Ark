"""Pick which drone flies each order. Imported directly by the fleet simulator: keep signatures stable."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from energy import MAX_ONE_WAY_KM, RESERVE_PCT, Trip, bearing_deg, haversine_km, trip, wind_along_ms
from routing import Storm, inside, path_around
from weather import CAUTION_MAX_ONE_WAY_KM

TIE_MIN = 0.5


def home_key(lat: float, lon: float) -> str:
    """Key of a hub in Conditions.hub_calls."""
    return f"{lat:.4f},{lon:.4f}"


@dataclass(frozen=True)
class Conditions:
    """Weather for one pick: storm cells and the fly call (call, reason) per hub, keyed by home_key."""

    storms: tuple[Storm, ...] = ()
    hub_calls: Mapping[str, tuple[str, str]] = field(default_factory=dict)


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
    route: tuple[tuple[float, float], ...] = ()  # out path's middle waypoints, empty when straight


def _trip_for(
    order: Order,
    drone: DroneState,
    wind_ms: float,
    wind_from_deg: float,
    out_path: Sequence[tuple[float, float]] | None = None,
    back_path: Sequence[tuple[float, float]] | None = None,
) -> Trip:
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
        out_path=out_path,
        back_path=back_path,
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
    extra: str = "",
) -> str:
    text = (
        f"{drone.id} is {t.out_km:.1f} km away with {drone.battery_pct:.0f}% battery and {wind}: "
        f"{t.out_min:.0f} min to the drop, lands home with {after_pct:.0f}%."
    )
    if runner is not None:
        text += f" Next best {runner[0].id} ({runner[1].out_min:.0f} min)."
    if extra:
        text += f" {extra}"
    return text[:400]


def _hub_call(drone: DroneState, conditions: Conditions | None) -> tuple[str, str]:
    if conditions is None:
        return "go", ""
    return conditions.hub_calls.get(home_key(drone.home_lat, drone.home_lon), ("go", ""))


def _storm_id_near(waypoint: tuple[float, float], storms: Sequence[Storm]) -> str:
    return min(storms, key=lambda s: haversine_km(waypoint[0], waypoint[1], s.lat, s.lon) - s.radius_km).id


def held_reason(order: Order, drones: Sequence[DroneState], conditions: Conditions | None) -> str | None:
    """Why an order cannot be served right now because of the weather, or None."""
    if conditions is None:
        return None
    for s in conditions.storms:
        if inside(order.dest_lat, order.dest_lon, s):
            return f"Drop is inside {s.id} ({s.rain_mm_h:.0f} mm/h)"
    usable = [d for d in drones if d.status == "available" and order.payload_kg <= d.max_payload_kg]
    calls = [_hub_call(d, conditions) for d in usable]
    if calls and all(c == "no_go" for c, _ in calls):
        reason = next((r for _, r in calls if r), "no-go")
        return f"Every hub is on hold: {reason}"
    return None


def choose_drone(
    order: Order,
    drones: Sequence[DroneState],
    wind_ms: float,
    wind_from_deg: float,
    *,
    conditions: Conditions | None = None,
) -> Choice | None:
    """Fastest eligible drone; ties within 0.5 min go to the higher battery."""
    storms = conditions.storms if conditions else ()
    dest = (order.dest_lat, order.dest_lon)
    eligible: list[tuple[DroneState, Trip, list[tuple[float, float]] | None]] = []
    skipped: list[tuple[float, DroneState, str]] = []
    for d in drones:
        if d.status != "available" or order.payload_kg > d.max_payload_kg:
            continue
        call, reason = _hub_call(d, conditions)
        if call == "no_go":
            skipped.append((haversine_km(d.lat, d.lon, *dest), d, reason))
            continue
        limit = CAUTION_MAX_ONE_WAY_KM if call == "caution" else MAX_ONE_WAY_KM
        out_path = back_path = None
        if storms:
            out_path = path_around((d.lat, d.lon), dest, storms)
            back_path = path_around(dest, (d.home_lat, d.home_lon), storms)
            if out_path is None or back_path is None:
                continue
        t = _trip_for(order, d, wind_ms, wind_from_deg, out_path, back_path)
        if t.out_km > limit or d.battery_pct - t.battery_used_pct < RESERVE_PCT:
            continue
        eligible.append((d, t, out_path))
    if not eligible:
        return None

    eligible.sort(key=lambda p: p[1].out_min)
    fastest = eligible[0][1].out_min
    best = max((p for p in eligible if p[1].out_min <= fastest + TIE_MIN), key=lambda p: p[0].battery_pct)
    rest = [(p[0], p[1]) for p in eligible if p is not best]
    runner = rest[0] if rest else None

    drone, t, out_path = best
    after = drone.battery_pct - t.battery_used_pct
    wind = _wind_phrase(order, drone, wind_ms, wind_from_deg)
    route = tuple(out_path[1:-1]) if out_path else ()
    extras = []
    if route:
        straight = haversine_km(drone.lat, drone.lon, *dest)
        extras.append(f"Routes {t.out_km - straight:.1f} km around {_storm_id_near(route[0], storms)}.")
    # only a held drone that was closer than the pick explains anything; one at another hub was never a candidate
    closer = [s for s in skipped if s[0] < haversine_km(drone.lat, drone.lon, *dest)]
    if closer:
        _, held, reason = min(closer, key=lambda s: s[0])
        extras.append(f"Skipped {held.id} (hub on hold: {reason or 'no-go'}).")
    return Choice(
        order_id=order.id,
        drone_id=drone.id,
        eta_min=t.out_min,
        trip=t,
        battery_after_pct=after,
        runner_up=runner[0].id if runner else None,
        rationale=_rationale(drone, t, after, wind, runner, " ".join(extras)),
        route=route,
    )


def assign(
    orders: Sequence[Order],
    drones: Sequence[DroneState],
    wind_ms: float,
    wind_from_deg: float,
    now_s: float,
    *,
    conditions: Conditions | None = None,
) -> list[Choice]:
    """Serve orders by priority (urgency first, then wait time); each drone is used once."""
    # shortcut: greedy per-order pick, upgrade to a joint assignment / VRP solver past ~50 drones.
    # shortcut: storms are static during a pick, re-run assign as the cells move.
    ranked = sorted(orders, key=lambda o: o.urgency * 10 + (now_s - o.created_s) / 60.0, reverse=True)
    pool = list(drones)
    out: list[Choice] = []
    for order in ranked:
        choice = choose_drone(order, pool, wind_ms, wind_from_deg, conditions=conditions)
        if choice is None:
            continue
        out.append(choice)
        pool = [d for d in pool if d.id != choice.drone_id]
    return out

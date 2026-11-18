"""Pure fleet state: kinematic drones, a Poisson order stream, and dispatch through the optimiser. No MQTT here."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from energy import DELIVERY_HOVER_S, bearing_deg, cruise_w, ground_speed_ms, haversine_km, hover_w, pct
from optimiser import DroneState, Order, assign, held_reason
from routing import path_around

from .ids import ulid
from .network import DRONES_PER_HUB, DROP_POINTS, HUBS, DropPoint
from .weather import DemoStorm, HubWx, calm, conditions_at, weather_message

CRUISE_ALT_M = 60.0
CLIMB_MS = 4.0
SWAP_S = 180.0  # hub crew swaps the 12S7P pack for a charged one; the flat pack charges off-line
MAX_PAYLOAD_KG = 2.0
RANGE_KM = 20
KM_PER_DEG = 111.19
ORDERS_PER_MIN = 0.7  # ~80 % of what 24 drones serve with ~25 min trips and 3 min swaps
PROMISE_MIN = 30.0  # order to drop: the delivery promise "on time" is measured against
EPOCH = datetime(2026, 1, 1, tzinfo=UTC)  # default sim clock start, fixed so seeded runs are reproducible
RELIEF_ITEMS = ("Water purification tablets", "First-aid kit", "Insulin cooler")


@dataclass
class FleetDrone:
    id: str
    hub: str
    home_lat: float
    home_lon: float
    lat: float
    lon: float
    battery_pct: float
    alt_m: float = 0.0
    heading_deg: float = 0.0
    status: str = "available"  # available | assigned | in_flight | charging
    phase: str = "idle"  # idle | climb | outbound | deliver | inbound | descend
    mission: dict[str, Any] | None = None
    route: list[tuple[float, float]] = field(default_factory=list)  # remaining points, the first is the target
    ground_speed_ms: float = 0.0
    hover_left_s: float = 0.0
    swap_left_s: float = 0.0


@dataclass
class _Queued:
    order: Order
    drop: DropPoint
    item: str


@dataclass
class _Track:
    created_s: float
    delivered_s: float | None = None


def _payload_kg(d: FleetDrone) -> float:
    """Carried until the drop: loaded power out, empty power back."""
    return float(d.mission["payloadKg"]) if d.mission and d.phase in ("climb", "outbound", "deliver") else 0.0


class Fleet:
    def __init__(
        self,
        seed: int,
        wind_ms: float,
        wind_from_deg: float,
        drones_per_hub: int = DRONES_PER_HUB,
        epoch: datetime | None = None,
        storms_enabled: bool = True,
    ):
        self.rng = random.Random(seed)
        # shortcut: one wind for the whole network (Papar's); use per-hub wind in the flight model if hubs differ much.
        self.wind_ms, self.wind_from_deg = wind_ms, wind_from_deg
        self.storms_enabled = storms_enabled
        self.demo_storm = DemoStorm()
        self.hub_wx: list[HubWx] = calm(HUBS, wind_ms, wind_from_deg)
        self.epoch = epoch or EPOCH
        self.now_s = 0.0
        self.drones: list[FleetDrone] = []
        n = 101
        for hub in HUBS:
            for _ in range(drones_per_hub):
                self.drones.append(
                    FleetDrone(
                        id=f"ARK-{n}",
                        hub=hub.name,
                        home_lat=hub.lat,
                        home_lon=hub.lon,
                        lat=hub.lat,
                        lon=hub.lon,
                        battery_pct=self.rng.uniform(85.0, 100.0),
                    )
                )
                n += 1
        self.queue: list[_Queued] = []
        self.tracks: dict[str, _Track] = {}  # mission id -> timing, for the average delivery time
        self._by_id = {d.id: d for d in self.drones}
        self._next_order_s = self.rng.expovariate(ORDERS_PER_MIN / 60)
        self._delivered = 0
        self.held: dict[str, str] = {}  # queued order id -> why it waits (weather), for stats
        self._refresh_weather(0.0)

    # --- weather -------------------------------------------------------------------------------------------------

    def set_hub_weather(self, hub_wx: list[HubWx]) -> None:
        self.hub_wx = hub_wx
        self._refresh_weather(self.now_s)

    def _refresh_weather(self, now_s: float) -> None:
        self.storms = (self.demo_storm.at(now_s),) if self.storms_enabled else ()
        self.conditions, self.hubs_json = conditions_at(self.hub_wx, self.storms)
        self.storms_json = [self.demo_storm.json(now_s)] if self.storms_enabled else []

    def weather(self, now_iso: str) -> dict[str, Any]:
        source = "open-meteo+demo-storm" if self.storms_enabled else "open-meteo"
        return weather_message(now_iso, source, self.hubs_json, self.storms_json)

    # --- clock helpers -------------------------------------------------------------------------------------------

    def iso(self, t_s: float) -> str:
        return (self.epoch + timedelta(seconds=t_s)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def _ulid(self, t_s: float) -> str:
        return ulid(self.rng, int((self.epoch + timedelta(seconds=t_s)).timestamp() * 1000))

    # --- orders --------------------------------------------------------------------------------------------------

    def spawn_orders(self, now_s: float) -> list[Order]:
        """Poisson arrivals (ORDERS_PER_MIN across the network) up to `now_s`; queued for the next dispatch."""
        new: list[Order] = []
        while self._next_order_s <= now_s:
            t = self._next_order_s
            self._next_order_s += self.rng.expovariate(ORDERS_PER_MIN / 60)
            drop = self.rng.choice(DROP_POINTS)
            if self.rng.random() < 0.75:
                mode, urgency, item = "gdex", self.rng.randint(1, 2), "GDEX parcel"
                kg = round(self.rng.uniform(0.3, 2.0), 2)
            else:
                mode, urgency, item = "relief", self.rng.randint(3, 5), self.rng.choice(RELIEF_ITEMS)
                kg = round(self.rng.uniform(0.5, 2.0), 2)
            order = Order(
                id=f"ord_{self._ulid(t)}",
                mode=mode,
                dest_lat=drop.lat,
                dest_lon=drop.lon,
                payload_kg=kg,
                urgency=urgency,
                created_s=t,
            )
            self.queue.append(_Queued(order, drop, item))
            new.append(order)
        return new

    # --- records -------------------------------------------------------------------------------------------------

    def drone_record(self, d: FleetDrone) -> dict[str, Any]:
        rec: dict[str, Any] = {
            "id": d.id,
            "model": "Ark-1",
            "status": d.status,
            "home": {"lat": d.home_lat, "lon": d.home_lon},
            "maxPayloadKg": MAX_PAYLOAD_KG,
            "rangeKm": RANGE_KM,
            "batteryPct": round(min(max(d.battery_pct, 0.0), 100.0), 1),
            "lastSeenAt": self.iso(self.now_s),
        }
        if d.mission:
            rec["missionId"] = d.mission["id"]
        return rec

    def records(self) -> list[dict[str, Any]]:
        return [self.drone_record(d) for d in self.drones]

    def telemetry(self, now_iso: str) -> list[dict[str, Any]]:
        out = []
        for d in self.drones:
            t: dict[str, Any] = {
                "droneId": d.id,
                "ts": now_iso,
                "position": {"lat": d.lat, "lon": d.lon, "altM": round(d.alt_m, 1)},
                # shortcut: flat ground at 10 m AMSL for every hub and drop; use the terrain tiles if height matters.
                "altAmslM": round(d.alt_m + 10.0, 1),
                "headingDeg": d.heading_deg % 360.0,
                "groundSpeedMs": round(d.ground_speed_ms, 1),
                "armed": d.phase != "idle",
                "flightMode": "STABILIZE" if d.phase == "idle" else "LAND" if d.phase == "descend" else "AUTO",
                "batteryPct": round(min(max(d.battery_pct, 0.0), 100.0), 1),
                "linkType": "lte",
                "linkQuality": 0.9,
            }
            if d.mission:
                t["missionId"] = d.mission["id"]
            out.append(t)
        return out

    def stats(self) -> dict[str, Any]:
        done = [(t.delivered_s - t.created_s) / 60 for t in self.tracks.values() if t.delivered_s is not None]
        on_time = sum(1 for m in done if m <= PROMISE_MIN)
        calls = {"go": 0, "caution": 0, "no_go": 0}
        for h in self.hubs_json:
            calls[h["call"]] += 1
        return {
            "flying": sum(1 for d in self.drones if d.status == "in_flight"),
            "queued": len(self.queue),
            "held": len(self.held),
            "weatherCalls": calls,
            "deliveredTotal": self._delivered,
            "avgDeliveryMin": round(sum(done) / len(done), 1) if done else 0.0,
            "onTimePct": round(100 * on_time / len(done), 1) if done else 100.0,
            "promiseMin": PROMISE_MIN,
        }

    # --- simulation ----------------------------------------------------------------------------------------------

    def tick(self, dt_s: float, now_s: float) -> list[dict[str, Any]]:
        """Advance every drone by `dt_s` and return the mission and drone changes to publish."""
        self.now_s = now_s
        events: list[dict[str, Any]] = []
        self.spawn_orders(now_s)
        self._refresh_weather(now_s)
        self._dispatch(now_s, events)
        for d in self.drones:
            self._step(d, dt_s, now_s, events)
        return events

    @staticmethod
    def _state(d: FleetDrone) -> DroneState:
        return DroneState(d.id, d.lat, d.lon, d.home_lat, d.home_lon, d.status, d.battery_pct, MAX_PAYLOAD_KG)

    def _dispatch(self, now_s: float, events: list[dict[str, Any]]) -> None:
        free = [d for d in self.drones if d.status == "available"]
        if self.queue and free:
            choices = assign(
                [q.order for q in self.queue],
                [self._state(d) for d in free],
                self.wind_ms,
                self.wind_from_deg,
                now_s,
                conditions=self.conditions,
            )
            for c in choices:
                q = next((x for x in self.queue if x.order.id == c.order_id), None)
                d = self._by_id.get(c.drone_id)
                if q is None or d is None or d.status != "available":
                    continue
                self.queue.remove(q)
                d.mission = self._mission(d, q, c, now_s)
                d.status = "assigned"
                # shortcut: in-flight drones do not re-route when the storm moves onto their path; re-plan per tick
                # with path_around when that matters.
                d.route = [*c.route, (q.drop.lat, q.drop.lon)]
                self.tracks[d.mission["id"]] = _Track(created_s=q.order.created_s)
                # shortcut: auto-approved (straight to `dispatched`); the real flow waits for an operator in Ark Command.
                events.append({"kind": "mission", "data": dict(d.mission)})
                events.append({"kind": "drone", "data": self.drone_record(d)})
        states = [self._state(d) for d in self.drones]
        self.held = {}
        for q in self.queue:
            why = held_reason(q.order, states, self.conditions)
            if why is not None:
                self.held[q.order.id] = why

    def _mission(self, d: FleetDrone, q: _Queued, c: Any, now_s: float) -> dict[str, Any]:
        weight = round(q.order.payload_kg, 2)
        extra: dict[str, Any] = (
            {"waypoints": [{"lat": lat, "lon": lon} for lat, lon in c.route[:50]]} if c.route else {}
        )
        return {
            **extra,
            "id": f"msn_{self._ulid(now_s)}",
            "mode": q.order.mode,
            "droneId": d.id,
            "createdAt": self.iso(now_s),
            "status": "dispatched",
            "origin": {"lat": d.home_lat, "lon": d.home_lon},
            "destination": {"lat": q.drop.lat, "lon": q.drop.lon},
            "landingType": "water" if q.drop.water else "ground",
            "payload": [{"item": q.item, "qty": 1, "weightKg": weight}],
            "payloadKg": weight,
            "distanceKm": round(c.trip.out_km, 2),
            "etaMinutes": round(c.eta_min, 1),
            "aiRationale": c.rationale,
        }

    def _set_mission(self, d: FleetDrone, status: str, events: list[dict[str, Any]]) -> None:
        assert d.mission is not None
        d.mission["status"] = status
        events.append({"kind": "mission", "data": dict(d.mission)})

    def _drone_event(self, d: FleetDrone, events: list[dict[str, Any]]) -> None:
        events.append({"kind": "drone", "data": self.drone_record(d)})

    def _drain_hover(self, d: FleetDrone, dt_s: float) -> None:
        d.battery_pct -= pct(hover_w(_payload_kg(d)) * dt_s / 3600)

    def _fly_to(self, d: FleetDrone, dt_s: float) -> bool:
        """Move toward the next point of the route; True on arriving at the last one."""
        tlat, tlon = d.route[0]
        dist = haversine_km(d.lat, d.lon, tlat, tlon)
        brg = bearing_deg(d.lat, d.lon, tlat, tlon)
        gs = max(ground_speed_ms(brg, self.wind_ms, self.wind_from_deg), 1.0)
        step = min(gs * dt_s / 1000, dist)
        d.heading_deg = brg
        d.ground_speed_ms = gs
        if step >= dist:
            d.lat, d.lon = tlat, tlon
        else:
            r = math.radians(brg)
            # shortcut: flat-earth step (steps are under 0.1 km); use a great-circle destination if dt grows.
            d.lat += step * math.cos(r) / KM_PER_DEG
            d.lon += step * math.sin(r) / (KM_PER_DEG * math.cos(math.radians(d.lat)))
        d.battery_pct -= pct(cruise_w(_payload_kg(d)) * (step * 1000 / gs) / 3600)
        if step >= dist:
            d.route.pop(0)
            return not d.route
        return False

    def _step(self, d: FleetDrone, dt_s: float, now_s: float, events: list[dict[str, Any]]) -> None:
        d.ground_speed_ms = 0.0
        ph = d.phase
        if ph == "idle":
            if d.status == "assigned":
                d.status, d.phase = "in_flight", "climb"
                self._set_mission(d, "in_flight", events)
                self._drone_event(d, events)
            elif d.status == "charging":  # pack swap at the hub
                d.swap_left_s -= dt_s
                if d.swap_left_s <= 0:
                    d.battery_pct, d.status = 100.0, "available"
                    self._drone_event(d, events)
        elif ph == "climb":
            d.alt_m = min(CRUISE_ALT_M, d.alt_m + CLIMB_MS * dt_s)
            self._drain_hover(d, dt_s)
            if d.alt_m >= CRUISE_ALT_M:
                d.phase = "outbound"
        elif ph == "outbound":
            if self._fly_to(d, dt_s):
                d.phase, d.hover_left_s = "deliver", DELIVERY_HOVER_S
        elif ph == "deliver":
            d.hover_left_s -= dt_s
            self._drain_hover(d, dt_s)
            if d.hover_left_s <= 0:
                assert d.mission is not None
                self._set_mission(d, "delivered", events)
                self.tracks[d.mission["id"]].delivered_s = now_s
                self._delivered += 1
                dest = (d.lat, d.lon)
                home = (d.home_lat, d.home_lon)
                around = path_around(dest, home, self.storms) or []
                # drop endpoints in case path_around includes them; only the middle points are waypoints
                d.route = [p for p in around if p != dest and p != home] + [home]
                d.phase = "inbound"
        elif ph == "inbound":
            if self._fly_to(d, dt_s):
                d.phase = "descend"
        elif ph == "descend":
            d.alt_m = max(0.0, d.alt_m - CLIMB_MS * dt_s)
            self._drain_hover(d, dt_s)
            if d.alt_m <= 0.0:
                d.phase, d.status, d.mission, d.swap_left_s = "idle", "charging", None, SWAP_S
                self._drone_event(d, events)


__all__ = ["EPOCH", "Fleet", "FleetDrone", "haversine_km"]

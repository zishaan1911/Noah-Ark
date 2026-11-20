"""MQTT runner for the fleet sim.

    python -m ark_fleet --broker broker:1883 [--drones-per-hub 4] [--speedup 4] [--seed 7] [--no-storm] [--wear-warp 100]

Publishes telemetry (with health sensors) to `ark/<droneId>/telemetry`, changes to `fleet/live`, and the retained
`fleet/stats` and `fleet/weather`. Listens on `ark/+/events` for health-monitor `fault` verdicts and grounds drones.
"""

from __future__ import annotations

import argparse
import json
import queue
import random
import time
import urllib.request
from datetime import UTC, datetime

import paho.mqtt.client as mqtt

from .health import HealthLayer, sensor_fields
from .network import HUBS
from .sim import Fleet
from .weather import fetch_hub_weather

PAPAR = next(h for h in HUBS if h.name == "Papar")
WIND_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms"
)


def current_wind(lat: float, lon: float) -> tuple[float, float, str | None]:
    """(speed m/s, direction it blows FROM in degrees, error detail or None); calm on any failure."""
    try:
        with urllib.request.urlopen(WIND_URL.format(lat=lat, lon=lon), timeout=10) as r:
            cur = json.load(r)["current"]
        return float(cur["wind_speed_10m"]), float(cur["wind_direction_10m"]), None
    except Exception as e:  # noqa: BLE001 (any network or format failure means calm air)
        return 0.0, 0.0, f"wind unavailable, calm air: {e}"


def now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", required=True, help="host:port")
    ap.add_argument("--drones-per-hub", type=int, default=4)
    ap.add_argument("--speedup", type=float, default=4.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-storm", action="store_true", help="skip the demo storm cell")
    ap.add_argument("--wear-warp", type=float, default=100.0, help="wear-clock speed: faults grow over a few flights")
    a = ap.parse_args()
    host, _, port = a.broker.rpartition(":")

    wind_ms, wind_from, detail = current_wind(PAPAR.lat, PAPAR.lon)
    if detail:
        print(detail, flush=True)
    fleet = Fleet(a.seed, wind_ms, wind_from, a.drones_per_hub, epoch=datetime.now(UTC), storms_enabled=not a.no_storm)

    def refresh_weather() -> None:
        hub_wx, wx_detail = fetch_hub_weather(HUBS)
        if wx_detail:
            print(wx_detail, flush=True)
        fleet.set_hub_weather(hub_wx)

    refresh_weather()
    last_wx = time.monotonic()
    # shortcut: 30 days of showers and fault schedule; restart the sim for longer runs.
    # Healthy spells of ~20 wear-days: at warp 100 about one drone in six is wearing out at any time.
    health = HealthLayer(fleet.drones, 30, random.Random(a.seed + 1), warp=a.wear_warp, healthy_days=20.0)
    verdicts: queue.SimpleQueue[tuple[str, dict]] = queue.SimpleQueue()  # MQTT thread -> sim loop

    def on_connect(c, _userdata, _flags, _reason, _props) -> None:
        c.subscribe("ark/+/events", qos=1)

    def on_message(_c, _userdata, msg) -> None:
        try:
            ev = json.loads(msg.payload)
        except ValueError:
            return
        h = ev.get("health") if isinstance(ev, dict) and ev.get("type") == "fault" else None
        if isinstance(h, dict) and h.get("state") in ("ok", "watch", "ground") and isinstance(ev.get("droneId"), str):
            verdicts.put((ev["droneId"], h))

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(host, int(port))
    client.loop_start()

    def live(kind: str, data: dict) -> None:
        client.publish("fleet/live", json.dumps({"kind": kind, "data": data}), qos=1)

    def publish_records() -> None:
        for rec in fleet.records():
            live("drone", rec)

    def publish_stats() -> None:
        stats = fleet.stats() | {"windMs": wind_ms, "windFromDeg": wind_from, "speedup": a.speedup}
        client.publish("fleet/stats", json.dumps(stats), qos=1, retain=True)

    def publish_weather() -> None:
        client.publish("fleet/weather", json.dumps(fleet.weather(now_iso())), qos=1, retain=True)

    publish_records()
    publish_stats()
    publish_weather()
    print(f"fleet sim: {len(fleet.drones)} drones, speedup {a.speedup:g}, seed {a.seed}", flush=True)

    start = time.monotonic()
    sim_s, tick_n = 0.0, 0
    try:
        while True:
            tick_n += 1
            time.sleep(max(0.0, start + tick_n - time.monotonic()))  # fixed 1 s cadence, no drift
            dt = 1.0 * a.speedup
            sim_s += dt
            while not verdicts.empty():
                drone_id, h = verdicts.get()
                if (rec := fleet.apply_health(drone_id, h)) is not None:
                    live("drone", rec)
            for ev in fleet.tick(dt, sim_s):
                live(ev["kind"], ev["data"])
            for drone_id in fleet.repaired:
                health.repair(drone_id, sim_s)
            fleet.repaired.clear()
            samples = {d.id: s for d in fleet.drones if (s := health.step(d, sim_s, dt)) is not None}
            for t in fleet.telemetry(now_iso()):
                if (s := samples.get(t["droneId"])) is not None:
                    t |= sensor_fields(s)
                client.publish(f"ark/{t['droneId']}/telemetry", json.dumps(t), qos=0)
            if tick_n % 10 == 0:
                publish_records()  # a dashboard that opens late fills in
                publish_stats()
                publish_weather()
            if time.monotonic() - last_wx >= 600:
                last_wx = time.monotonic()
                refresh_weather()
    except KeyboardInterrupt:
        print("stopping", flush=True)
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()

"""MQTT runner for the fleet sim.

    python -m ark_fleet --broker broker:1883 [--drones-per-hub 4] [--speedup 4] [--seed 7] [--no-storm]

Publishes telemetry to `ark/<droneId>/telemetry`, changes to `fleet/live`, and the retained `fleet/stats` and `fleet/weather`.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from datetime import UTC, datetime

import paho.mqtt.client as mqtt

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

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
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
            sim_s += 1.0 * a.speedup
            for ev in fleet.tick(1.0 * a.speedup, sim_s):
                live(ev["kind"], ev["data"])
            for t in fleet.telemetry(now_iso()):
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

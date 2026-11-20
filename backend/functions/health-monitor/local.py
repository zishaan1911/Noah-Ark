"""Local stand-in for the IoT rule + Lambda: buffer each drone's flight off MQTT and score it when it ends.

    python local.py --broker localhost:1883

Subscribes to `ark/+/telemetry`; when a drone disarms (or starts a new mission) the finished flight goes through
`handler`, and any verdict is published on `ark/<droneId>/events`.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from typing import Any

import paho.mqtt.client as mqtt

from handler import handler


@dataclass
class Flights:
    """Per-drone buffer of the flight in progress; `feed` returns the flights that just ended."""

    open: dict[str, tuple[str, list[dict[str, Any]]]] = field(default_factory=dict)

    def feed(self, t: dict[str, Any]) -> list[dict[str, Any]]:
        drone, mission = t.get("droneId"), t.get("missionId", "")
        if not isinstance(drone, str):
            return []
        done = []
        cur = self.open.get(drone)
        if cur and (not t.get("armed") or mission != cur[0]):
            done.append({"droneId": drone, "missionId": cur[0], "samples": cur[1]})
            del self.open[drone]
        if t.get("armed") and mission:
            self.open.setdefault(drone, (mission, []))[1].append(t)
        return done


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--broker", default="localhost:1883", help="host:port")
    a = ap.parse_args()
    host, _, port = a.broker.rpartition(":")
    flights = Flights()

    def on_connect(c, _userdata, _flags, _reason, _props) -> None:
        c.subscribe("ark/+/telemetry", qos=0)

    def on_message(c, _userdata, msg) -> None:
        try:
            t = json.loads(msg.payload)
        except ValueError:
            return
        if not isinstance(t, dict):
            return
        for flight in flights.feed(t):
            try:
                ev = handler(flight)
            except Exception as e:  # noqa: BLE001  (one bad flight must not stop the monitor)
                print(f"health-monitor: {flight['droneId']} {flight['missionId']}: {e}", flush=True)
                continue
            if ev is not None:
                c.publish(f"ark/{ev['droneId']}/events", json.dumps(ev), qos=1)
                print(f"health-monitor: {ev['droneId']} {ev['health']['state']}: {ev['message']}", flush=True)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(host, int(port))
    print(f"health-monitor: listening on {a.broker}", flush=True)
    client.loop_forever()


if __name__ == "__main__":
    main()

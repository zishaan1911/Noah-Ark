"""A long-running Ark-1 SITL on real terrain, respawned wherever Ark Command asks.

    python -m ark_sim.live --broker broker:1883 --drone ARK-006 [--lat 5.7346 --lon 115.9302] [--speedup 1]

Listens on MQTT `sim/<drone>/spawn {"lat","lon"}` and (re)boots the official ArduCopter SITL there, on AWS terrain
tiles and the current Open-Meteo wind. Progress goes to the retained `sim/<drone>/status`. A separate gateway
connects to SITL MAVLink tcp:<sim>:5760 and flies the missions; SITL blocks on boot until it does.
"""

from __future__ import annotations

import argparse
import json
import math
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

import paho.mqtt.client as mqtt

from .bridge import Bridge
from .model import HW, load
from .physics import Sim, World
from .scenarios import PONT, Pilot
from .terrain import Terrain

ROOT = Path(__file__).resolve().parents[1]
PAPAR = (5.7346, 115.9302)  # Papar, Sabah
WIND_URL = (
    "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
    "&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms"
)


def current_wind(lat: float, lon: float) -> tuple[float, float, float, str | None]:
    """(speed m/s, direction it blows FROM in degrees, gust std m/s, error detail or None); calm on any failure."""
    try:
        with urllib.request.urlopen(WIND_URL.format(lat=lat, lon=lon), timeout=10) as r:
            cur = json.load(r)["current"]
        s, d, g = float(cur["wind_speed_10m"]), float(cur["wind_direction_10m"]), float(cur["wind_gusts_10m"])
        # shortcut: gust std estimated from the 10 m gust peak, no height profile, use a wind-shear power law if needed.
        return s, d, max(g - s, 0.0) / 2, None
    except Exception as e:  # noqa: BLE001 (any network or format failure means calm air)
        return 0.0, 0.0, 0.0, f"wind unavailable, calm air: {e}"


class Runner:
    def __init__(self, drone: str, speedup: float, publish):
        self.drone, self.speedup, self.publish = drone, speedup, publish
        self.sim: Sim | None = None
        self.bridge: Bridge | None = None
        self.proc: subprocess.Popen | None = None
        self.pilot: Pilot | None = None
        self.log = None
        self.work: Path | None = None
        self.pump_stop = threading.Event()
        self.pump_thread: threading.Thread | None = None

    def status(self, state: str, **kw) -> None:
        self.publish({"state": state, **kw})

    def spawn(self, lat: float, lon: float) -> None:
        if self.pilot is not None and self.pilot.armed:
            self.status("error", detail="drone is flying; land it first")
            return
        try:
            self.status("booting", lat=lat, lon=lon)
            self.stop()
            t = Terrain(lat, lon)
            s, d, gust, detail = current_wind(lat, lon)
            rad = math.radians(d)
            world = World(terrain=t, wind_ned=(-s * math.cos(rad), -s * math.sin(rad), 0.0), gust=gust)
            self.sim = Sim(load(), world)
            self.bridge = Bridge(self.sim)
            self.bridge.start()
            self.boot(lat, lon, t.h0)
            extra = {"detail": detail} if detail else {}
            self.status(
                "ready", lat=lat, lon=lon, groundAmslM=t.h0, windMs=s, windFromDeg=d, speedup=self.speedup, **extra
            )
        except Exception as e:  # noqa: BLE001 (report it and keep listening)
            print(f"spawn failed: {e!r}", flush=True)
            self.stop()
            self.status("error", detail=str(e))

    def boot(self, lat: float, lon: float, h0: float) -> None:
        """Same boot as scenarios.run, at the spawn point with the live params."""
        self.work = Path(tempfile.mkdtemp(prefix="ark-live-"))
        shutil.copytree(HW / "flight" / "scripts", self.work / "scripts")
        self.log = open(self.work / "arducopter.log", "w")  # noqa: SIM115 (lives as long as the run)
        defaults = f"{ROOT / 'params' / 'ark1-sitl.parm'},{ROOT / 'params' / 'ark1-live.parm'}"
        self.proc = subprocess.Popen(
            ["arducopter", "--model", "JSON:127.0.0.1", "--speedup", f"{self.speedup:g}", "-w", "-I0",
             "--home", f"{lat},{lon},{h0:.1f},0", "--defaults", defaults],
            cwd=self.work, stdout=self.log, stderr=subprocess.STDOUT,
        )  # fmt: skip
        end = time.monotonic() + 180  # SITL opens SERIAL2 only after the gateway connects to SERIAL0
        while True:
            try:
                self.pilot = Pilot(self.bridge, url="tcp:127.0.0.1:5763")  # our own link on SERIAL2
                break
            except OSError:
                if time.monotonic() > end:
                    raise
                time.sleep(2)
        if not self.pilot.wait(lambda: self.pilot.has_param("PONT_ENABLE"), 60, "Lua script params"):
            raise RuntimeError("pontoon script did not start (see arducopter.log)")
        for k, v in (PONT | {"PONT_PLAN_WTR": 0}).items():
            self.pilot.set_param(k, v)
        self.pump_stop.clear()
        self.pump_thread = threading.Thread(target=self._pump, args=(self.pilot,), daemon=True)
        self.pump_thread.start()

    def _pump(self, pilot: Pilot) -> None:
        while not self.pump_stop.is_set():  # keeps Pilot.armed fresh for the refuse-while-flying rule
            try:
                pilot.pump(0.2)
            except Exception:  # noqa: BLE001 (link is closing or restarting)
                time.sleep(0.2)

    def stop(self) -> None:
        had_run = self.bridge is not None
        if self.bridge:
            self.bridge.stop.set()
        self.pump_stop.set()
        if self.pump_thread:
            self.pump_thread.join(2)
        if self.proc:
            self.proc.kill()  # SITL ignores SIGTERM while it waits on the stopped physics
            self.proc.wait(10)
        if self.pilot:
            self.pilot.mav.close()
        if self.log:
            self.log.close()
        if self.work:
            shutil.rmtree(self.work, ignore_errors=True)
        self.sim = self.bridge = self.proc = self.pilot = self.log = self.work = self.pump_thread = None
        if had_run:
            time.sleep(1.0)  # the bridge's UDP and MAVLink threads notice `stop` within 0.5 s and free port 9002


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--broker", required=True, help="host:port")
    ap.add_argument("--drone", default="ARK-006")
    ap.add_argument("--lat", type=float, default=PAPAR[0])
    ap.add_argument("--lon", type=float, default=PAPAR[1])
    ap.add_argument("--speedup", type=float, default=1.0)
    a = ap.parse_args()
    host, _, port = a.broker.rpartition(":")
    spawn_topic, status_topic = f"sim/{a.drone}/spawn", f"sim/{a.drone}/status"

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    runner = Runner(a.drone, a.speedup, lambda d: client.publish(status_topic, json.dumps(d), qos=1, retain=True))
    requests: queue.Queue[tuple[float, float]] = queue.Queue()

    def on_connect(c, _userdata, _flags, _reason, _props) -> None:
        c.subscribe(spawn_topic, qos=1)  # here, so a reconnect subscribes again

    def on_message(_c, _userdata, msg) -> None:
        try:
            d = json.loads(msg.payload)
            lat, lon = float(d["lat"]), float(d["lon"])
            if not (-85 <= lat <= 85 and -180 <= lon <= 180):
                raise ValueError("out of range")
        except (ValueError, KeyError, TypeError):
            print(f"ignored bad spawn request: {msg.payload!r}", flush=True)
            return
        requests.put((lat, lon))  # the worker thread does the slow work, not this callback

    client.on_connect, client.on_message = on_connect, on_message
    client.connect(host, int(port))
    client.loop_start()

    def worker() -> None:
        while True:
            runner.spawn(*requests.get())

    threading.Thread(target=worker, daemon=True).start()
    requests.put((a.lat, a.lon))

    last_sim, last_wall = 0.0, time.monotonic()
    while True:
        time.sleep(10)
        sim = runner.sim  # a local copy: the worker may swap it between the two reads
        now = time.monotonic()
        if sim is not None:
            t = sim.t
            if t >= last_sim:
                print(f"real-time factor {(t - last_sim) / (now - last_wall):.2f}", flush=True)
            last_sim = t
        else:
            last_sim = 0.0
        last_wall = now


if __name__ == "__main__":
    main()

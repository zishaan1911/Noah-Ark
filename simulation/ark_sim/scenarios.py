"""Fly Ark-1 scenarios in ArduCopter SITL against the Ark-1 physics, check them, and save the results.

    python -m ark_sim.scenarios <name> [--no-write]      (inside the noah-ark-sitl container; see README)

Each run: start the bridge, boot the official arducopter SITL binary with the Ark-1 params and the real
hardware/flight/scripts/pontoon_trigger.lua, load the PONT_* params from hardware/flight/pontoon.parm, fly the
scenario over MAVLink, then judge it from the physics' ground truth and the script's own messages.
Writes simulation/results/<name>.json (track + events + checks) and hardware/ark.json -> simulation.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from pymavlink import mavutil

from .bridge import PIN, Bridge
from .model import HW, load
from .physics import Faults, Sim, World

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
HOME = "5.4855,118.2340,10,0"  # Kinabatangan river, Sabah (a flood-relief site)
PONT = {
    k: float(v)
    for k, v in (
        ln.split(",") for ln in (HW / "flight" / "pontoon.parm").read_text().splitlines() if ln.startswith("PONT_")
    )
}
PONT |= {"PONT_PS_L_PIN": PIN["PS_L"], "PONT_PS_R_PIN": PIN["PS_R"]}  # SITL pins (see params/ark1-sitl.parm)


@dataclass
class Scenario:
    name: str
    about: str
    world: World
    start_floating: bool = False
    faults: Faults = field(default_factory=Faults)
    params: dict = field(default_factory=dict)


SCENARIOS = {
    s.name: s
    for s in (
        Scenario(
            "water_landing",
            "Planned water landing: take off from the bank, fly 100 m out over the river, LAND. "
            "Waves Hs 0.3 m, wind 4 m/s from the west with 1 m/s gusts.",
            World(shore_n=40, hs=0.3, wave_dir_deg=30, wind_ned=(0, 4, 0), gust=1.0),
            params={"PONT_PLAN_WTR": 1},
        ),
        Scenario(
            "one_side_fails",
            "Planned water landing with the left inflator jammed: the script retries it, holds in GUIDED and the "
            "operator diverts the drone home to land on the bank.",
            World(shore_n=40, hs=0.3, wave_dir_deg=30, wind_ned=(0, 4, 0), gust=1.0),
            faults=Faults({"L": 99, "R": 0}),
            params={"PONT_PLAN_WTR": 1},
        ),
        Scenario(
            "water_takeoff",
            "Floating on the inflated tubes after a landing (kit fired): take off from the water, fly 30 m, land "
            "on the water again. Waves Hs 0.3 m, wind 6 m/s with 1.5 m/s gusts.",
            World(all_water=True, hs=0.3, wave_dir_deg=0, wind_ned=(0, 6, 0), gust=1.5),
            start_floating=True,
            params={"PONT_PLAN_WTR": 1, "PONT_FIRED": 1},
        ),
        Scenario(
            "ditching",
            "Emergency: over the river on a delivery (no water landing planned), the battery hits its low-voltage "
            "failsafe and the drone lands where it is. No companion water flag, so stale counts as water.",
            World(shore_n=40, hs=0.3, wave_dir_deg=30, wind_ned=(0, 4, 0), gust=1.0),
            params={"PONT_PLAN_WTR": 0},
        ),
    )
}


class Pilot:
    """Ground station: drives SITL over MAVLink and logs the script's messages against sim time."""

    def __init__(self, bridge: Bridge, url: str = "tcp:127.0.0.1:5760"):
        self.b = bridge
        self.mav = mavutil.mavlink_connection(url, source_system=255, autoreconnect=True)
        self.mav.wait_heartbeat(timeout=120)
        self.events: list[tuple[float, str]] = []
        self.mode, self.armed = "", False
        self.params: dict[str, float] = {}

    @property
    def t(self) -> float:
        return self.b.sim.t

    def pump(self, timeout: float = 0.05) -> None:
        end = time.monotonic() + timeout
        while (msg := self.mav.recv_match(blocking=True, timeout=max(end - time.monotonic(), 0))) is not None:
            k = msg.get_type()
            if k == "STATUSTEXT":
                if not self.events or self.events[-1][1] != msg.text:  # pre-arm failures repeat every second
                    self.events.append((round(self.t, 2), msg.text))
                    print(f"[{self.t:7.1f}] {msg.text}", flush=True)
            elif k == "PARAM_VALUE":
                self.params[msg.param_id] = msg.param_value
            elif k == "HEARTBEAT" and msg.get_srcSystem() == self.mav.target_system and msg.type != 6:
                self.mode = mavutil.mode_string_v10(msg)
                self.armed = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
            if time.monotonic() > end:
                break

    def wait(self, cond, sim_s: float, what: str) -> bool:
        t_end = self.t + sim_s
        while self.t < t_end:
            self.pump()
            if cond():
                return True
        print(f"[{self.t:7.1f}] timeout: {what}", flush=True)
        return False

    def hold(self, sim_s: float) -> None:
        t_end = self.t + sim_s
        while self.t < t_end:
            self.pump()

    def set_param(self, name: str, value: float) -> None:
        for _ in range(10):
            self.mav.param_set_send(name, value)
            if self.wait(lambda: abs(self.params.get(name, math.nan) - value) < 1e-3, 2, f"set {name}"):
                return
        raise RuntimeError(f"could not set {name}")

    def has_param(self, name: str) -> bool:
        self.mav.param_fetch_one(name)
        return self.wait(lambda: name in self.params, 2, f"param {name}")

    def set_mode(self, mode: str) -> None:
        self.mav.set_mode(self.mav.mode_mapping()[mode])
        self.wait(lambda: self.mode == mode, 10, f"mode {mode}")

    def arm(self) -> None:
        def try_arm() -> bool:
            if int(self.t * 2) % 4 == 0:
                self.mav.arducopter_arm()
            return self.armed

        if not self.wait(try_arm, 180, "arm"):
            raise RuntimeError("did not arm (see the PreArm messages above)")

    def takeoff(self, alt: float) -> None:
        self.mav.mav.command_long_send(
            self.mav.target_system,
            self.mav.target_component,
            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            alt,
        )

    def goto(self, n: float, e: float, alt: float) -> None:
        self.mav.mav.set_position_target_local_ned_send(
            0, self.mav.target_system, self.mav.target_component, mavutil.mavlink.MAV_FRAME_LOCAL_NED,
            0b110111111000, n, e, -alt, 0, 0, 0, 0, 0, 0, 0, 0,
        )  # fmt: skip

    def alt(self) -> float:
        return -self.b.sim.p[2]

    def at(self, n: float, e: float, tol: float = 2.0) -> bool:
        return math.hypot(self.b.sim.p[0] - n, self.b.sim.p[1] - e) < tol


def fly(sc: Scenario, p: Pilot) -> None:
    """The flight plan per scenario (GUIDED, then the autopilot's own LAND / RTL / failsafe logic)."""
    sim = p.b.sim
    p.set_mode("GUIDED")
    p.arm()
    if sc.name == "water_takeoff":
        p.takeoff(10)
        p.wait(lambda: p.alt() > 9.0, 60, "climb to 10 m")
        p.hold(5)
        p.goto(30, 0, 10)
        p.wait(lambda: p.at(30, 0), 40, "reach 30 m")
        p.set_mode("LAND")
        p.wait(lambda: not p.armed, 90, "landed and disarmed")
        p.hold(10)
        return
    p.takeoff(20)
    p.wait(lambda: p.alt() > 19.0, 60, "climb to 20 m")
    p.goto(100, 0, 20)
    p.wait(lambda: p.at(100, 0), 60, "reach 100 m out")
    p.hold(3)
    if sc.name == "ditching":
        p.set_param("BATT_LOW_VOLT", sim.v_bus + 1.0)  # the pack reaches its low-voltage threshold here
        p.wait(lambda: p.mode == "LAND", 20, "battery failsafe LAND")
    else:
        p.set_mode("LAND")
    if sc.name == "one_side_fails":
        p.wait(lambda: any("FAILED" in e for _, e in p.events), 120, "script verdict")
        p.hold(10)
        p.set_mode("RTL")  # the operator (or the Ark Brain) diverts it to land on the bank
        p.wait(lambda: not p.armed, 150, "RTL landed and disarmed")
        return
    p.wait(lambda: not p.armed, 120, "landed and disarmed")
    p.hold(20)  # float


def judge(sc: Scenario, b: Bridge, p: Pilot) -> dict:
    cols = Bridge.TRACK_COLS
    tr = [dict(zip(cols, row, strict=True)) for row in b.track]
    ev = p.events
    sim, world = b.sim, sc.world
    over_water = [r for r in tr if world.is_water(r["n"])]
    on_water = [r for r in over_water if r["skid_h"] < 0.05]
    t_touch = on_water[0]["t"] if on_water else None
    fire = next((e for e in ev if "FIRE at" in e[1]), None)
    ok_t = {s: next((t for t, e in ev if f"{s} pressure OK" in e), None) for s in "LR"}
    tilt_water = max((max(abs(r["roll"]), abs(r["pitch"])) for r in on_water), default=None)
    checks: dict[str, bool] = {}
    out: dict = {"about": sc.about}
    if fire:
        out["fire_height_m"] = float(re.search(r"FIRE at ([\d.]+)", fire[1]).group(1))
        out["fire_t_s"] = fire[0]
    out["touchdown_t_s"] = t_touch
    out["pressure_ok_t_s"] = ok_t
    out["max_tilt_on_water_deg"] = tilt_water
    out["min_prop_clearance_m"] = None if math.isinf(sim.min_prop_clear) else round(sim.min_prop_clear, 3)
    checks["not_sunk"] = not sim.sunk
    if sc.name in ("water_landing", "ditching"):
        checks["fired_once"] = sum("FIRE at" in e for _, e in ev) == 1
        # the script's rule: fire at max(FIRE_ALT, descent rate x INF_T x MARGIN + ABORT_ALT)
        if fire:
            vz = float(re.search(r"([\d.]+) m/s down", fire[1]).group(1))
            P = PONT
            out["fire_rule_m"] = round(
                max(P["PONT_FIRE_ALT"], vz * P["PONT_INF_T"] * P["PONT_MARGIN"] + P["PONT_ABORT_ALT"]), 2
            )
        checks["fired_at_rule_height"] = bool(fire) and abs(out["fire_height_m"] - out["fire_rule_m"]) < 1.0
        checks["both_tubes_up_before_touchdown"] = bool(t_touch) and all(
            t is not None and t < t_touch for t in ok_t.values()
        )
        checks["floats_level"] = tilt_water is not None and tilt_water < 30
        checks["props_clear_of_water"] = (out["min_prop_clearance_m"] or 0) > 0.1
    if sc.name == "ditching":
        checks["fired_for_failsafe"] = any("battery failsafe" in e for _, e in ev)
    if sc.name == "one_side_fails":
        checks["retried_left"] = any("retry fired" in e and "L" in e for _, e in ev)
        checks["aborted_and_held"] = any("FAILED" in e and "aborted" in e for _, e in ev)
        checks["never_touched_water"] = not on_water
        checks["landed_home_on_bank"] = not p.armed and not world.is_water(sim.p[0]) and sim.p[2] > -0.5
    if sc.name == "water_takeoff":
        lift = [r for r in tr if r["t"] < 60 and r["skid_h"] < 3]
        out["max_tilt_takeoff_deg"] = max((max(abs(r["roll"]), abs(r["pitch"])) for r in lift), default=None)
        checks["climbed_to_10_m"] = any(r["d"] < -9 for r in tr)
        checks["takeoff_level"] = (out["max_tilt_takeoff_deg"] or 99) < 25
        checks["props_clear_of_water"] = (out["min_prop_clearance_m"] or 0) > 0.1
        checks["landed_on_water_again"] = bool(on_water) and on_water[-1]["t"] > 30
    out["checks"] = {k: bool(v) for k, v in checks.items()}
    out["passed"] = all(out["checks"].values())
    return out


def run(name: str, write: bool = True) -> dict:
    sc = SCENARIOS[name]
    model = load()
    sim = Sim(model, sc.world, start_floating=sc.start_floating, faults=sc.faults)
    bridge = Bridge(sim)
    bridge.start()
    work = Path(tempfile.mkdtemp(prefix=f"ark-{name}-"))
    shutil.copytree(HW / "flight" / "scripts", work / "scripts")
    log = open(work / "arducopter.log", "w")  # noqa: SIM115 (lives as long as the process)
    proc = subprocess.Popen(
        ["arducopter", "--model", "JSON:127.0.0.1", "--speedup", "100", "-w", "-I0", "--home", HOME,
         "--defaults", str(ROOT / "params" / "ark1-sitl.parm")],
        cwd=work, stdout=log, stderr=subprocess.STDOUT,
    )  # fmt: skip
    try:
        p = Pilot(bridge)
        if not p.wait(lambda: p.has_param("PONT_ENABLE"), 60, "Lua script params"):
            raise RuntimeError("pontoon script did not start (see arducopter.log)")
        for k, v in (PONT | sc.params).items():
            p.set_param(k, v)
        p.hold(2)
        fly(sc, p)
        result = judge(sc, bridge, p)
    finally:
        bridge.stop.set()
        proc.kill()  # SITL ignores SIGTERM while it waits on the stopped physics
        proc.wait(10)
    result |= {"sim_s": round(sim.t, 1), "frames": bridge.frames, "model_auw_kg": round(model.mass, 3),
               "cg_hw_m": [round(float(v), 4) for v in model.cg_hw]}  # fmt: skip
    print(json.dumps({k: v for k, v in result.items() if k != "about"}, indent=1))
    if write:
        RESULTS.mkdir(exist_ok=True)
        world = {k: getattr(sc.world, k) for k in ("shore_n", "bank_m", "hs", "all_water")}
        full = result | {
            "events": p.events,
            "track_cols": list(Bridge.TRACK_COLS),
            "track": bridge.track,
            "world": world,
        }
        (RESULTS / f"{name}.json").write_text(json.dumps(full, separators=(",", ":")))
        ark_file = HW / "ark.json"
        ark = json.loads(ark_file.read_text(encoding="utf-8"))
        simk = ark.setdefault("simulation", {"note": "simulation/ark_sim: ArduCopter 4.7.2 SITL + Ark-1 physics"})
        simk.setdefault("result", {})[name] = result
        ark_file.write_text(json.dumps(ark, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("name", choices=[*SCENARIOS, "all"])
    ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    if a.name == "all":  # one process per run: a fresh SITL, bridge and ports each time
        flags = ["--no-write"] if a.no_write else []
        bad = [
            n
            for n in SCENARIOS
            if subprocess.run(["python", "-u", "-m", "ark_sim.scenarios", n, *flags], check=False).returncode
        ]
        raise SystemExit(f"failed to run: {bad}" if bad else 0)
    if not run(a.name, write=not a.no_write)["passed"]:
        raise SystemExit(1)

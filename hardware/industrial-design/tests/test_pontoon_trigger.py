"""Run flight/scripts/pontoon_trigger.lua in Lua 5.3 (lupa) against mocked ArduPilot bindings and a simple descent."""

import json
from pathlib import Path

import pytest

lua53 = pytest.importorskip("lupa.lua53")

FLIGHT = Path(__file__).resolve().parents[2] / "flight"
SCRIPT = (FLIGHT / "scripts" / "pontoon_trigger.lua").read_text(encoding="utf-8")
SYSTEM = json.loads((FLIGHT.parent / "industrial-design" / "pontoon_system.json").read_text(encoding="utf-8"))

MOCKS = """
sim = {t = 0, armed = true, flying = true, mode = 9, nav = 0, rng = nil, rng_status = 4, vz = 0.5, fs = false,
       hagl = nil, ps = {}, relays = {}, relay_log = {}, texts = {}, params = {}, saved = {}, auth = nil}
param = {add_table = function(self) return true end,
         add_param = function(self, key, idx, name, def) sim.params['PONT_' .. name] = def; return true end}
function Parameter(name)
  return {get = function(self) return sim.params[name] end,
          set_and_save = function(self, v) sim.params[name] = v; sim.saved[name] = v end}
end
millis = function() return {tofloat = function() return sim.t end} end
gcs = {send_text = function(self, sev, msg) sim.texts[#sim.texts + 1] = {sev, msg} end}
rangefinder = {has_data_orient = function(self, o) return sim.rng ~= nil end,
               status_orient = function(self, o) return sim.rng_status end,
               distance_orient = function(self, o) return sim.rng / 100 end}
ahrs = {get_velocity_NED = function(self) return {z = function() return sim.vz end} end,
        get_hagl = function(self) return sim.hagl end}
relay = {on = function(self, i) sim.relays[i] = true; sim.relay_log[#sim.relay_log + 1] = {sim.t, i, true} end,
         off = function(self, i) sim.relays[i] = false; sim.relay_log[#sim.relay_log + 1] = {sim.t, i, false} end}
gpio = {read = function(self, pin) return not sim.ps[pin] end}
vehicle = {get_mode = function(self) return sim.mode end,
           set_mode = function(self, m) sim.mode = m; return true end,
           get_likely_flying = function(self) return sim.flying end}
arming = {is_armed = function(self) return sim.armed end, get_aux_auth_id = function(self) return 1 end,
          set_aux_auth_failed = function(self, id, msg) sim.auth = msg end,
          set_aux_auth_passed = function(self, id) sim.auth = 'ok' end}
battery = {has_failsafed = function(self) return sim.fs end}
mission = {get_current_nav_id = function(self) return sim.nav end}
logger = {write = function(self) end}
"""


class Flight:
    """Drone descending at vz onto water; each fired side reaches pressure-OK after t_ok unless it is broken."""

    def __init__(self, h=10.0, vz=0.5, t_ok=3.1, broken=(), **params):
        self.lua = lua53.LuaRuntime()
        self.lua.execute(MOCKS)
        self.sim = self.lua.globals().sim
        self.update = self.lua.execute(SCRIPT)[0]
        self.sim.t = 1000
        self.h, self.sim.vz, self.t_ok, self.broken = h, vz, t_ok, set(broken)
        self.fired_at = {}  # side -> list of times the side's coil was energised with ARM on
        for k, v in params.items():
            self.sim.params["PONT_" + k] = v
        self.set_radar()

    def set_radar(self):
        self.sim.rng = (max(self.h, 0) + 0.34) * 100

    def relay(self, i):
        return bool(self.sim.relays[i])

    def step(self, n=1):
        for _ in range(n):
            if self.sim.mode != 4:  # GUIDED holds height
                self.h -= self.sim.vz * 0.05
            self.set_radar()
            self.update()
            for side, idx, pin in (("L", 1, 55), ("R", 2, 56)):
                if self.relay(0) and self.relay(idx):
                    times = self.fired_at.setdefault(side, [])
                    if not times or self.sim.t - times[-1] > 500:
                        times.append(self.sim.t)
                fired = self.fired_at.get(side)
                if fired and side not in self.broken and self.sim.t - fired[0] >= self.t_ok * 1000:
                    self.sim.ps[pin] = True
            self.sim.t += 50

    def texts(self):
        return [self.sim.texts[i][2] for i in range(1, len(self.sim.texts) + 1)]

    def p(self, name):
        return self.sim.params["PONT_" + name]


def test_planned_water_landing_fires_once_at_the_firing_height_and_confirms():
    f = Flight(h=10.0, PLAN_WTR=1)
    f.step(300)
    assert set(f.fired_at) == {"L", "R"}
    assert len(f.fired_at["L"]) == 1 and len(f.fired_at["R"]) == 1  # no re-fire
    h_at_fire = 10.0 - 0.5 * (f.fired_at["L"][0] - 1000) / 1000
    assert h_at_fire == pytest.approx(f.p("FIRE_ALT"), abs=0.05)
    assert f.p("FIRED") == 1 and f.sim.saved["PONT_FIRED"] == 1
    assert not f.relay(0) and not f.relay(1) and not f.relay(2)  # pulse ended
    assert any("L pressure OK" in t for t in f.texts()) and any("R pressure OK" in t for t in f.texts())
    assert f.sim.mode == 9  # still landing
    # inflation finishes before touchdown
    t_touch = 1000 + 10.0 / 0.5 * 1000
    assert f.fired_at["L"][0] + f.t_ok * 1000 < t_touch


def test_pulse_length_and_arm_interlock():
    f = Flight(h=6.5, PLAN_WTR=1)
    f.step(60)
    log = [
        (f.lua.eval("sim.relay_log")[i][1], f.lua.eval("sim.relay_log")[i][2], f.lua.eval("sim.relay_log")[i][3])
        for i in range(1, len(f.lua.eval("sim.relay_log")) + 1)
    ]
    on = {i: t for t, i, s in log if s}
    off = {i: t for t, i, s in log if not s}
    assert on[0] <= on[1] and on[0] <= on[2]
    assert off[1] - on[1] == pytest.approx(f.p("PULSE_MS"), abs=60)
    assert off[0] >= off[1]


def test_does_nothing_without_a_water_landing_or_failsafe():
    f = Flight(h=8.0)
    f.step(250)
    assert not f.fired_at
    assert f.p("FIRED") == 0


def test_emergency_ditching_fires_when_water_flag_is_stale_but_not_over_land():
    f = Flight(h=8.0, vz=0.5)
    f.sim.fs, f.sim.mode = True, 9
    f.step(200)
    assert set(f.fired_at) == {"L", "R"}
    assert any("stale" in t for t in f.texts())

    g = Flight(h=8.0, vz=0.5)
    g.sim.fs = True
    for k in range(250):  # companion keeps saying "land" (fresh flag)
        g.sim.params["PONT_WTR_SEQ"] = k
        g.sim.params["PONT_OVERWTR"] = 0
        g.step()
    assert not g.fired_at


def test_fast_descent_fires_higher():
    f = Flight(h=30.0, vz=2.0, PLAN_WTR=1)
    f.step(400)
    h_at_fire = 30.0 - 2.0 * (f.fired_at["L"][0] - 1000) / 1000
    expected = 2.0 * f.p("INF_T") * f.p("MARGIN") + f.p("ABORT_ALT")
    assert h_at_fire == pytest.approx(expected, abs=0.15)


def test_one_side_fails_retries_that_side_once_then_aborts_the_planned_landing():
    f = Flight(h=8.0, PLAN_WTR=1, broken=("R",))
    f.step(600)
    assert len(f.fired_at["L"]) == 1
    assert len(f.fired_at["R"]) == 2  # first fire + one retry
    retry = f.fired_at["R"][1] - f.fired_at["R"][0]
    assert retry == pytest.approx(f.p("RETRY_T") * 1000, abs=60)
    assert f.sim.mode == 4  # GUIDED hold: landing aborted
    assert any("FAILED" in t and "aborted" in t for t in f.texts())


def test_spent_kit_blocks_arming_and_firing():
    f = Flight(h=8.0, PLAN_WTR=1, FIRED=1)
    f.step(200)
    assert not f.fired_at
    assert "spent" in f.sim.auth


def test_floating_on_inflated_tubes_may_take_off_again_but_never_refires():
    f = Flight(h=0.0, PLAN_WTR=1, FIRED=1)
    f.sim.ps[55] = f.sim.ps[56] = True
    f.step(100)
    assert f.sim.auth == "ok"
    assert not f.fired_at


def test_lua_defaults_match_the_generated_params():
    parm = dict(
        line.split(",") for line in (FLIGHT / "pontoon.parm").read_text().splitlines() if line.startswith("PONT_")
    )
    f = Flight()
    for k, v in parm.items():
        assert f.p(k.removeprefix("PONT_")) == pytest.approx(float(v)), k
    assert float(parm["PONT_FIRE_ALT"]) == SYSTEM["trigger"]["fire_alt_m"]

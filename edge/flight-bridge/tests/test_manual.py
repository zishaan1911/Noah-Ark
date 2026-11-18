import json
import math
import time
from types import SimpleNamespace as NS

from ark_contracts import ManualControl

from flight_bridge.gateway import Gateway
from flight_bridge.manual import MAX_HORIZONTAL_MS, MAX_VERTICAL_MS, MAX_YAW_DEG_S, setpoint


def stick(seq=1, f=0.0, r=0.0, up=0.0, yaw=0.0, drone="ARK-006") -> dict:
    return {"droneId": drone, "ts": "2026-11-18T09:40:00Z", "seq": seq, "forwardMs": f, "rightMs": r,
            "upMs": up, "yawRateDegS": yaw}  # fmt: skip


def test_setpoint_clamps_keeping_direction():
    f, r, down, yaw = setpoint(ManualControl.model_validate(stick(f=20, r=20, up=5, yaw=-90)))
    assert math.hypot(f, r) == MAX_HORIZONTAL_MS + 0 or abs(math.hypot(f, r) - MAX_HORIZONTAL_MS) < 1e-9
    assert abs(f - r) < 1e-9  # still 45 degrees
    assert down == -MAX_VERTICAL_MS  # up is negative down (NED)
    assert yaw == math.radians(-MAX_YAW_DEG_S)


class FakeMav:
    """Records velocity setpoints; reports modes as set."""

    def __init__(self, gw):
        self.sent, self.gw = [], gw
        self.target_system = self.target_component = 1
        self.mav = self

    def set_position_target_local_ned_send(self, *a):
        self.sent.append(a[8:11])  # vx, vy, vz (after time, target sys/comp, frame, mask, x, y, z)

    def mode_mapping(self):
        return {"GUIDED": 4}

    def set_mode(self, _):
        self.gw.mode = "GUIDED"

    def recv_match(self, **_):
        return None


def airborne_gateway(armed=True, alt_mm=30_000) -> Gateway:
    g = Gateway("localhost:1883", "tcp:127.0.0.1:1", "ARK-006")
    g.mav = FakeMav(g)
    g.armed = armed
    g.state["GLOBAL_POSITION_INT"] = NS(relative_alt=alt_mm, lat=0, lon=0)
    g.events = []
    g.emit = lambda t, sev="info", msg=None, **kw: g.events.append(t)
    g._telemetry = lambda: None
    return g


def test_stick_flies_guided_and_watchdog_holds():
    g = airborne_gateway()
    g.handle_manual(json.dumps(stick(seq=1, f=5)).encode())
    assert g.mode == "GUIDED" and g.manual_on and g.events == ["manual_started"]
    assert g.mav.sent[-1] == (5.0, 0.0, -0.0)
    g.manual_last = time.monotonic() - 1.5  # the operator's link goes quiet
    g._manual_watchdog()
    assert g.mav.sent[-1] == (0, 0, 0) and g.manual_holding
    g.manual_last = time.monotonic() - 6
    g._manual_watchdog()
    assert not g.manual_on and g.events[-1] == "manual_ended"


def test_stale_and_foreign_packets_are_dropped():
    g = airborne_gateway()
    g.handle_manual(json.dumps(stick(seq=5, f=3)).encode())
    g.handle_manual(json.dumps(stick(seq=4, f=9)).encode())  # reordered
    g.handle_manual(json.dumps(stick(seq=6, f=9, drone="ARK-001")).encode())
    assert len(g.mav.sent) == 1


def test_refused_on_the_ground_once():
    g = airborne_gateway(alt_mm=500)
    for i in range(3):
        g.handle_manual(json.dumps(stick(seq=i + 1, f=3)).encode())
    assert not g.manual_on and g.mav.sent == [] and g.events == ["manual_ended"]

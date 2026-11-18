from types import SimpleNamespace as NS

from ark_contracts import Telemetry

from flight_bridge.telemetry import build_telemetry


def make_state(hdg: int = 9000, bat: int = 80) -> dict:
    return {
        "HEARTBEAT": NS(
            base_mode=1 | 128, custom_mode=3, type=2, autopilot=3, get_type=lambda: "HEARTBEAT"
        ),  # custom mode + armed, ACM AUTO
        "GLOBAL_POSITION_INT": NS(lat=46012000, lon=1010777000, alt=52000, relative_alt=42000, hdg=hdg),
        "VFR_HUD": NS(groundspeed=11.5, climb=0.5, heading=90),
        "ATTITUDE": NS(roll=0.1, pitch=-0.05),
        "SYS_STATUS": NS(battery_remaining=77, voltage_battery=24600),
        "BATTERY_STATUS": NS(battery_remaining=bat),
        "VIBRATION": NS(vibration_x=1.0, vibration_y=2.0, vibration_z=3.0),
        "pontoons": "stowed",
    }


def test_validates():
    d = build_telemetry(make_state(), "ARK-001", "msn_01JD8X5Q2M9VTRC3B7K4N6P0WY")
    t = Telemetry.model_validate(d)
    assert t.armed and t.flightMode == "AUTO"
    assert d["position"]["altM"] == 42 and d["altAmslM"] == 52
    assert d["batteryPct"] == 80 and d["batteryVoltageV"] == 24.6
    assert "motorTempC" not in d


def test_heading_wraps():
    assert build_telemetry(make_state(hdg=36000), "ARK-001", None)["headingDeg"] == 0


def test_battery_falls_back_to_sys_status():
    assert build_telemetry(make_state(bat=-1), "ARK-001", None)["batteryPct"] == 77


def test_omits_missing_sources():
    s = make_state()
    for k in ("VFR_HUD", "ATTITUDE", "SYS_STATUS", "BATTERY_STATUS", "VIBRATION"):
        del s[k]
    d = build_telemetry(s, "ARK-001", None)
    Telemetry.model_validate(d)
    assert d["batteryPct"] == 0 and "rollDeg" not in d and "vibration" not in d

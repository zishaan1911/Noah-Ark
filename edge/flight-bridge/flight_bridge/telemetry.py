"""MAVLink messages -> a `Telemetry` dict (shared/schemas/telemetry.schema.json)."""

from __future__ import annotations

import math
from datetime import UTC, datetime

from pymavlink import mavutil

M = mavutil.mavlink


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_telemetry(state: dict, drone_id: str, mission_id: str | None) -> dict:
    """`state` maps a MAVLink message type to its latest message, plus the gateway's own "pontoons" string.

    Needs GLOBAL_POSITION_INT and HEARTBEAT (the schema requires them); every other field is left out until its
    source message has arrived.
    """
    gp, hb = state["GLOBAL_POSITION_INT"], state["HEARTBEAT"]
    vfr, att, vib = (state.get(k) for k in ("VFR_HUD", "ATTITUDE", "VIBRATION"))
    sys_, bat = state.get("SYS_STATUS"), state.get("BATTERY_STATUS")
    out: dict = {
        "droneId": drone_id,
        "ts": utc_now(),
        "position": {"lat": gp.lat / 1e7, "lon": gp.lon / 1e7, "altM": gp.relative_alt / 1000},
        "altAmslM": gp.alt / 1000,
        "armed": bool(hb.base_mode & M.MAV_MODE_FLAG_SAFETY_ARMED),
        "flightMode": mavutil.mode_string_v10(hb),
        "linkType": "lte",
        "linkQuality": 1.0,  # shortcut: link fixed to LTE 1.0 in the sim, read the modem RSSI on the Jetson.
    }
    if mission_id:
        out["missionId"] = mission_id
    if gp.hdg != 65535:
        out["headingDeg"] = (gp.hdg / 100) % 360
    elif vfr:
        out["headingDeg"] = vfr.heading % 360
    if vfr:
        out["groundSpeedMs"] = vfr.groundspeed
        out["climbRateMs"] = vfr.climb
    if att:
        out["rollDeg"] = math.degrees(att.roll)
        out["pitchDeg"] = math.degrees(att.pitch)
    pct = next((m.battery_remaining for m in (bat, sys_) if m and m.battery_remaining != -1), 0)
    out["batteryPct"] = min(max(pct, 0), 100)
    if sys_ and sys_.voltage_battery != 65535:  # 65535 = unknown
        out["batteryVoltageV"] = sys_.voltage_battery / 1000
    if vib:
        out["vibration"] = [vib.vibration_x, vib.vibration_y, vib.vibration_z]
    if "pontoons" in state:
        out["pontoons"] = state["pontoons"]
    return out

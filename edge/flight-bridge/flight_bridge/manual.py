"""Operator stick stream (ark/<id>/manual) -> clamped GUIDED velocity setpoints. Pure functions, no I/O."""

from __future__ import annotations

import math

from ark_contracts import ManualControl

MAX_HORIZONTAL_MS = 10.0  # well inside Ark-1's 17 m/s cruise: manual flying is for short repositioning
MAX_VERTICAL_MS = 3.0
MAX_YAW_DEG_S = 45.0
WATCHDOG_S = 1.0  # no packet for this long: hold position
SESSION_END_S = 5.0  # no packet for this long: the manual session is over (the drone keeps holding)


def setpoint(m: ManualControl) -> tuple[float, float, float, float]:
    """(forward, right, down m/s, yaw rate rad/s), clamped. The body frame is heading-aligned (MAV_FRAME_BODY_OFFSET_NED)."""
    f, r = m.forwardMs, m.rightMs
    h = math.hypot(f, r)
    if h > MAX_HORIZONTAL_MS:  # keep the direction, cap the speed
        f, r = f * MAX_HORIZONTAL_MS / h, r * MAX_HORIZONTAL_MS / h
    up = max(-MAX_VERTICAL_MS, min(MAX_VERTICAL_MS, m.upMs))
    yaw = max(-MAX_YAW_DEG_S, min(MAX_YAW_DEG_S, m.yawRateDegS))
    return f, r, -up, math.radians(yaw)

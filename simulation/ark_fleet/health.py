"""Health sensors for the fleet sim: motor and pack temperatures, pack voltage under load, vibration and the moisture
sensor, from first-order physics with the Ark-1 constants (ark_sim/model.py), plus four slowly developing faults.

Used live by `python -m ark_fleet` (wear sped up so a fault grows over a few flights) and offline by
ml/predictive-maintenance/generate.py (wear in real time, to build the training set). One physics for both.
"""

from __future__ import annotations

import math
import random
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from energy import cruise_w, hover_w  # dispatch-agent, put on the path by ark_fleet

from ark_sim.model import load

from .sim import FleetDrone, _payload_kg

FAULTS = ("bearing_wear", "prop_damage", "weak_cell", "seal_leak")
UTC_OFFSET_H = 8  # Sabah

# Thermal constants (est.): picked so a healthy motor sits ~25 K over ambient in hover, as outrunners this size do.
MOTOR_C_J_K = 200.0
MOTOR_R_FLY_K_W = 0.55  # prop wash over the bell
MOTOR_R_IDLE_K_W = 2.5
IRON_LOSS_FRAC = 0.06  # of shaft power
PACK_C_J_K = 5200.0  # 84 x 21700 cells, ~5.8 kg at 900 J/kg K
PACK_R_FLY_K_W = 0.5
PACK_R_IDLE_K_W = 1.5

# Fault strength at severity 1 (failure).
BEARING_TORQUE_NM = 0.25  # extra friction: ~60 W more heat in the motor at hover speed
BEARING_VIBE = 12.0  # m/s^2 broadband, all axes
PROP_VIBE = 25.0  # m/s^2 at hover speed, x/y (once-per-rev imbalance)
CELL_R_GAIN = 2.0  # pack resistance x (1 + 2) at failure
CELL_FADE = 0.3  # capacity lost at failure


@dataclass
class Fault:
    id: str  # <droneId>#<n>
    kind: str
    motor: int | None  # 1..4 for motor faults
    onset_s: float
    fail_s: float  # severity reaches 1: the part is replaced
    fail_flight_s: float = 0.0  # the drone's flight-seconds at its last airborne moment with this fault

    def severity(self, t: float) -> float:
        if t < self.onset_s:
            return 0.0
        return min(((t - self.onset_s) / (self.fail_s - self.onset_s)) ** 2, 1.0)  # wear accelerates


@dataclass
class Health:
    faults: list[Fault]
    motor_c: list[float] = field(default_factory=lambda: [30.0] * 4)
    pack_c: float = 30.0
    flight_s: float = 0.0  # cumulative airborne seconds, for the remaining-life label

    def active(self, t: float) -> Fault | None:
        return next((f for f in self.faults if f.onset_s <= t < f.fail_s), None)


def schedule(rng: random.Random, drone: str, end_s: float, healthy_days: float = 4.0) -> list[Fault]:
    """One fault at a time: a healthy spell, a fault that grows over days, replacement, repeat. Times in wear-clock s."""
    out, t = [], 0.0
    while True:
        t += rng.expovariate(1 / (healthy_days * 86400))
        if t >= end_s:
            return out
        kind = rng.choice(FAULTS)
        motor = rng.randint(1, 4) if kind in ("bearing_wear", "prop_damage") else None
        fail = t + rng.uniform(2, 6) * 86400
        out.append(Fault(f"{drone}#{len(out) + 1}", kind, motor, t, fail))
        t = fail


def ambient_c(t_s: float, raining: bool) -> float:
    hour = (t_s / 3600 + UTC_OFFSET_H) % 24
    return 28.5 + 4.0 * math.cos((hour - 14) / 24 * 2 * math.pi) - (3.0 if raining else 0.0)


def showers(rng: random.Random, hubs: list[str], days: int) -> dict[str, list[tuple[float, float, float]]]:
    """Afternoon convective showers per hub: (start s, end s, mm/h). Sabah gets one most days."""
    out: dict[str, list[tuple[float, float, float]]] = {h: [] for h in hubs}
    for h in hubs:
        for d in range(days):
            if rng.random() < 0.55:
                start = d * 86400 + (rng.uniform(13, 18) - UTC_OFFSET_H) * 3600
                out[h].append((start, start + rng.uniform(0.5, 3) * 3600, rng.uniform(3, 40)))
    return out


def rain_at(cells: list[tuple[float, float, float]], t: float) -> float:
    return next((mm for s, e, mm in cells if s <= t < e), 0.0)


class HealthLayer:
    def __init__(
        self,
        drones: Sequence[FleetDrone],
        days: int,
        rng: random.Random,
        warp: float = 1.0,
        healthy_days: float = 4.0,
    ):
        """`warp`: wear-clock speed over sim time (faults are scheduled in wear time; heat flows in sim time)."""
        self.m = load()
        self.rng = rng
        self.warp = warp
        end = days * 86400 * warp
        self.health = {d.id: Health(schedule(rng, d.id, end, healthy_days)) for d in drones}
        self.rain = showers(rng, sorted({d.hub for d in drones}), days)
        self.omega_hover = math.sqrt(self.m.mass * self.m.g / 4 / self.m.k_thrust)

    def repair(self, drone_id: str, t: float) -> None:
        """Maintenance replaced the worn part: the active fault ends now."""
        h = self.health[drone_id]
        if (f := h.active(t * self.warp)) is not None:
            f.fail_s = t * self.warp

    def step(self, d: FleetDrone, t: float, dt: float) -> dict[str, Any] | None:
        """Advance one drone's sensors by `dt`; a labelled sample while airborne, else None."""
        m, h, rng = self.m, self.health[d.id], self.rng
        flying = d.phase != "idle"
        rain = rain_at(self.rain[d.hub], t)
        amb = ambient_c(t, rain > 0)
        fault = h.active(t * self.warp)
        sev = fault.severity(t * self.warp) if fault else 0.0
        kind = fault.kind if fault else "none"

        payload = _payload_kg(d)
        hovering = d.phase in ("climb", "deliver", "descend")
        p_w = (hover_w(payload) if hovering else cruise_w(payload)) if flying else 0.0
        omega = self.omega_hover * (p_w / hover_w(0.0)) ** (1 / 3) if flying else 0.0  # power ~ omega^3

        rain_cool = 1 - 0.3 * min(rain / 30, 1.0)
        for i in range(4):
            extra = BEARING_TORQUE_NM * sev if kind == "bearing_wear" and fault and fault.motor == i + 1 else 0.0
            torque = (m.k_torque * omega**2 + m.ke * m.i0 + extra) if flying else 0.0
            amps = torque / m.ke
            loss = amps**2 * m.r_motor + IRON_LOSS_FRAC * m.k_torque * omega**3 + extra * omega
            r_th = (MOTOR_R_FLY_K_W if flying else MOTOR_R_IDLE_K_W) * rain_cool
            h.motor_c[i] += (loss - (h.motor_c[i] - amb) / r_th) / MOTOR_C_J_K * dt

        r_pack = m.r_pack * (1 + CELL_R_GAIN * sev if kind == "weak_cell" else 1)
        soc = min(max(d.battery_pct / 100, 0.0), 1.0)
        if kind == "weak_cell":  # the same Wh drawn from a smaller pack
            soc = max(1 - (1 - soc) / (1 - CELL_FADE * sev), 0.0)
        ocv = self._ocv(soc)
        amps_bus = p_w / ocv if flying else 0.0
        volts = ocv - amps_bus * r_pack
        r_pack_th = PACK_R_FLY_K_W if flying else PACK_R_IDLE_K_W
        h.pack_c += (amps_bus**2 * r_pack - (h.pack_c - amb) / r_pack_th) / PACK_C_J_K * dt
        if d.status == "charging":
            # The hub swaps in a rested pack. shortcut: a weak cell stays with the drone, not with one pack;
            # track pack serials if packs rotate between drones.
            h.pack_c = amb + 3.0

        if not flying:
            return None
        h.flight_s += dt
        if fault:
            fault.fail_flight_s = h.flight_s

        spin = (omega / self.omega_hover) ** 2
        vibe = [6.0 * spin, 6.0 * spin, 8.0 * spin]
        if kind == "prop_damage":
            vibe[0] += PROP_VIBE * sev * spin
            vibe[1] += PROP_VIBE * sev * spin
        if kind == "bearing_wear":
            vibe = [v + BEARING_VIBE * sev for v in vibe]
        vibe = [max(v * rng.lognormvariate(0, 0.15) + rng.gauss(0, 0.5), 0.0) for v in vibe]

        wet = min(rain / 20, 1.0)
        p_moist = sev * (0.1 + 0.8 * wet) if kind == "seal_leak" else 0.002 * wet  # healthy: condensation
        return {
            "rain": rain,
            "ambient": amb,
            "payload": payload,
            "volts": volts,
            "motor_c": [c + rng.gauss(0, 0.3) for c in h.motor_c],
            "pack_c": h.pack_c + rng.gauss(0, 0.2),
            "vibe": vibe,
            "moist": rng.random() < p_moist,
            "fault": fault,
            "sev": sev,
        }

    def _ocv(self, soc: float) -> float:
        m = self.m
        cell = (
            m.ocv_low + (m.ocv_full - m.ocv_low) * (soc - 0.2) / 0.8
            if soc >= 0.2
            else 3.0 + (m.ocv_low - 3.0) * soc / 0.2
        )
        return m.cells_s * cell


def sensor_fields(s: dict[str, Any]) -> dict[str, Any]:
    """The health part of a telemetry message (shared/schemas/telemetry.schema.json) from one `step` sample."""
    return {
        "batteryVoltageV": round(s["volts"], 2),
        "batteryTempC": round(s["pack_c"], 1),
        "airTempC": round(s["ambient"], 1),
        "motorTempC": [round(c, 1) for c in s["motor_c"]],
        "vibration": [round(v, 2) for v in s["vibe"]],
        "rainIntensity": round(s["rain"], 1),
        "onWater": False,
        "moistureDetected": s["moist"],
    }

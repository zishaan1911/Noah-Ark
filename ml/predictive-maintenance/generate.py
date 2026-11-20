"""Labelled health telemetry for predictive maintenance, generated from the Ark fleet sim with injected faults.

The fleet sim (simulation/ark_fleet) flies 24 drones on real dispatch. This adds what it does not model: motor and
pack temperatures, vibration, pack voltage under load and the moisture sensor, from first-order physics with the
Ark-1 constants (simulation/ark_sim/model.py), and four slowly developing faults. Run:

    python generate.py --days 14 --seed 7
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import random
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
# shortcut: puts simulation/ on the path instead of installing it as a package; package it if a second ml/ model needs it
sys.path.insert(0, str(REPO / "simulation"))

from ark_fleet.sim import Fleet, FleetDrone, _payload_kg
from ark_sim.model import load
from energy import cruise_w, hover_w  # dispatch-agent, put on the path by ark_fleet

OUT = REPO / "ml" / "datasets" / "raw" / "predictive-maintenance"
FAULTS = ("bearing_wear", "prop_damage", "weak_cell", "seal_leak")
DT_S = 5.0
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


def schedule(rng: random.Random, drone: str, end_s: float) -> list[Fault]:
    """One fault at a time: a healthy spell, a fault that grows over days, replacement, repeat."""
    out, t = [], 0.0
    while True:
        t += rng.expovariate(1 / (4 * 86400))  # healthy for ~4 days on average
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
    def __init__(self, fleet: Fleet, days: int, rng: random.Random):
        self.m = load()
        self.rng = rng
        end = days * 86400
        self.health = {d.id: Health(schedule(rng, d.id, end)) for d in fleet.drones}
        self.rain = showers(rng, sorted({d.hub for d in fleet.drones}), days)
        self.omega_hover = math.sqrt(self.m.mass * self.m.g / 4 / self.m.k_thrust)

    def step(self, d: FleetDrone, t: float) -> dict[str, Any] | None:
        """Advance one drone's sensors by DT_S; a labelled sample while airborne, else None."""
        m, h, rng = self.m, self.health[d.id], self.rng
        flying = d.phase != "idle"
        rain = rain_at(self.rain[d.hub], t)
        amb = ambient_c(t, rain > 0)
        fault = h.active(t)
        sev = fault.severity(t) if fault else 0.0
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
            h.motor_c[i] += (loss - (h.motor_c[i] - amb) / r_th) / MOTOR_C_J_K * DT_S

        r_pack = m.r_pack * (1 + CELL_R_GAIN * sev if kind == "weak_cell" else 1)
        soc = min(max(d.battery_pct / 100, 0.0), 1.0)
        if kind == "weak_cell":  # the same Wh drawn from a smaller pack
            soc = max(1 - (1 - soc) / (1 - CELL_FADE * sev), 0.0)
        ocv = self._ocv(soc)
        amps_bus = p_w / ocv if flying else 0.0
        volts = ocv - amps_bus * r_pack
        r_pack_th = PACK_R_FLY_K_W if flying else PACK_R_IDLE_K_W
        h.pack_c += (amps_bus**2 * r_pack - (h.pack_c - amb) / r_pack_th) / PACK_C_J_K * DT_S
        if d.status == "charging":
            # The hub swaps in a rested pack. shortcut: a weak cell stays with the drone, not with one pack;
            # track pack serials if packs rotate between drones.
            h.pack_c = amb + 3.0

        if not flying:
            return None
        h.flight_s += DT_S
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


def telemetry(d: FleetDrone, ts: str, s: dict[str, Any]) -> dict[str, Any]:
    """The sample as shared/schemas/telemetry.schema.json, what the drone streams on ark/<id>/telemetry."""
    t: dict[str, Any] = {
        "droneId": d.id,
        "ts": ts,
        "position": {"lat": d.lat, "lon": d.lon, "altM": round(d.alt_m, 1)},
        "headingDeg": round(d.heading_deg % 360.0, 1),
        "groundSpeedMs": round(d.ground_speed_ms, 1),
        "armed": True,
        "flightMode": "LAND" if d.phase == "descend" else "AUTO",
        "batteryPct": round(min(max(d.battery_pct, 0.0), 100.0), 1),
        "batteryVoltageV": round(s["volts"], 2),
        "batteryTempC": round(s["pack_c"], 1),
        "motorTempC": [round(c, 1) for c in s["motor_c"]],
        "vibration": [round(v, 2) for v in s["vibe"]],
        "rainIntensity": round(s["rain"], 1),
        "onWater": False,
        "moistureDetected": s["moist"],
    }
    if d.mission:
        t["missionId"] = d.mission["id"]
    return t


COLUMNS = [
    "droneId", "missionId", "ts", "lat", "lon", "altM", "headingDeg", "groundSpeedMs", "flightMode",
    "batteryPct", "batteryVoltageV", "batteryTempC", "motorTempC1", "motorTempC2", "motorTempC3", "motorTempC4",
    "vibrationX", "vibrationY", "vibrationZ", "rainIntensity", "moistureDetected",
    "phase", "payloadKg", "ambientC", "flightH",
    "label_fault", "label_fault_id", "label_motor", "label_severity", "label_rul_h",
]  # fmt: skip


def row(t: dict[str, Any], d: FleetDrone, s: dict[str, Any], flight_h: float) -> list[Any]:
    f: Fault | None = s["fault"]
    return [
        t["droneId"], t.get("missionId", ""), t["ts"], round(t["position"]["lat"], 6), round(t["position"]["lon"], 6),
        t["position"]["altM"], t["headingDeg"], t["groundSpeedMs"], t["flightMode"],
        t["batteryPct"], t["batteryVoltageV"], t["batteryTempC"], *t["motorTempC"], *t["vibration"],
        t["rainIntensity"], int(t["moistureDetected"]),
        d.phase, s["payload"], round(s["ambient"], 1), round(flight_h, 4),
        f.kind if f else "none", f.id if f else "", (f.motor or "") if f else "", round(s["sev"], 3),
        "",  # label_rul_h: filled in by the second pass
    ]  # fmt: skip


def run(
    days: float, seed: int, sample_s: float = 30.0
) -> Iterator[tuple[FleetDrone, dict[str, Any], dict[str, Any], HealthLayer]]:
    """Fly the fleet; yield (drone, telemetry, sample, layer) every `sample_s` while airborne."""
    rng = random.Random(seed + 1)
    fleet = Fleet(seed, wind_ms=3.0, wind_from_deg=90.0, storms_enabled=False)
    layer = HealthLayer(fleet, math.ceil(days), rng)
    every = round(sample_s / DT_S)
    t, n = 0.0, 0
    while t < days * 86400:
        t += DT_S
        n += 1
        fleet.tick(DT_S, t)
        ts = fleet.iso(t)
        for d in fleet.drones:
            s = layer.step(d, t)
            if s is not None and n % every == 0:
                yield d, telemetry(d, ts, s), s, layer


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--days", type=float, default=14)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--sample-s", type=float, default=30.0, help="seconds between kept in-flight samples")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    tmp, path = a.out / "telemetry.tmp.csv.gz", a.out / "telemetry.csv.gz"

    layer: HealthLayer | None = None
    n = 0
    with gzip.open(tmp, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(COLUMNS)
        for d, t, s, layer in run(a.days, a.seed, a.sample_s):
            w.writerow(row(t, d, s, layer.health[d.id].flight_s / 3600))
            n += 1
    assert layer is not None, "no samples: run longer"

    # Remaining life is known only once the fault has failed, so a second streaming pass fills it in.
    end_s = a.days * 86400
    fail_h = {f.id: f.fail_flight_s / 3600 for h in layer.health.values() for f in h.faults if f.fail_s <= end_s}
    i_id, i_h, i_rul = COLUMNS.index("label_fault_id"), COLUMNS.index("flightH"), COLUMNS.index("label_rul_h")
    with (
        gzip.open(tmp, "rt", newline="", encoding="utf-8") as src,
        gzip.open(path, "wt", newline="", encoding="utf-8") as dst,
    ):
        r, w = csv.reader(src), csv.writer(dst)
        w.writerow(next(r))
        for rec in r:
            if rec[i_id] in fail_h:  # censored (still growing when the run ends): left blank
                rec[i_rul] = f"{max(fail_h[rec[i_id]] - float(rec[i_h]), 0.0):.2f}"
            w.writerow(rec)
    tmp.unlink()

    truth = {did: [vars(f) for f in h.faults if f.onset_s < end_s] for did, h in layer.health.items()}
    (a.out / "faults.json").write_text(json.dumps({"days": a.days, "seed": a.seed, "drones": truth}, indent=1))
    print(f"{n} rows -> {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

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
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
# shortcut: puts simulation/ on the path instead of installing it as a package; package it if a second ml/ model needs it
sys.path.insert(0, str(REPO / "simulation"))

from ark_fleet.health import Fault, HealthLayer, sensor_fields
from ark_fleet.sim import Fleet, FleetDrone

OUT = REPO / "ml" / "datasets" / "raw" / "predictive-maintenance"
DT_S = 5.0


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
    } | sensor_fields(s)
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
    layer = HealthLayer(fleet.drones, math.ceil(days), rng)
    every = round(sample_s / DT_S)
    t, n = 0.0, 0
    while t < days * 86400:
        t += DT_S
        n += 1
        fleet.tick(DT_S, t)
        ts = fleet.iso(t)
        for d in fleet.drones:
            s = layer.step(d, t, DT_S)
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

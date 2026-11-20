"""Lambda entry: score one finished flight with the predictive-maintenance models and return a `fault` event.

Event: {"droneId": "ARK-104", "missionId": "msn_…", "samples": [telemetry, …]}   (shared/schemas/telemetry)
Returns a drone-event (type `fault`, with `health`) when the drone needs attention, else None.
"""

from __future__ import annotations

import os
import secrets
import sys
import time
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

REPO = Path(__file__).resolve().parents[3]
PM = REPO / "ml" / "predictive-maintenance"
# shortcut: imports the training feature code from the repo, so training and serving can't drift; package it
#   into the Lambda zip (or serve from a SageMaker endpoint) when the CDK ai stack lands.
sys.path.insert(0, str(PM))
from train import flight_features, rul_x

MODEL_PATH = Path(os.environ.get("MODEL_PATH", PM / "out" / "model.joblib"))
MIN_SAMPLES = 10  # shorter flights (aborts, hops) carry too little signal to score
GROUND_RUL_H = 8.0  # ground when the part has fewer flight-hours than about one day of deliveries
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
LABELS = {
    "bearing_wear": "Bearing wear (one motor running hot)",
    "prop_damage": "Prop damage (lateral vibration)",
    "weak_cell": "Weak cell (voltage sag)",
    "seal_leak": "Seal leak (moisture inside)",
    "unknown": "Unusual flight (no known fault)",
}


@cache
def model() -> dict[str, Any]:
    return joblib.load(MODEL_PATH)


def event_id(now_ms: int | None = None) -> str:
    """evt_ + a ULID: 48-bit ms time and 80 random bits, Crockford base32."""
    n = ((now_ms if now_ms is not None else int(time.time() * 1000)) << 80) | secrets.randbits(80)
    return "evt_" + "".join(CROCKFORD[(n >> (5 * i)) & 31] for i in range(25, -1, -1))


def rows(samples: list[dict[str, Any]]) -> pd.DataFrame:
    """Telemetry messages with health sensors -> the flat columns flight_features reads."""
    out = []
    for s in samples:
        if not (isinstance(s.get("motorTempC"), list) and isinstance(s.get("vibration"), list)):
            continue  # no health sensors on this message (idle, or a drone without them)
        m, v = s["motorTempC"], s["vibration"]
        out.append(
            {
                "droneId": s["droneId"],
                "missionId": s.get("missionId", ""),
                "ts": s["ts"],
                "motorTempC1": m[0], "motorTempC2": m[1], "motorTempC3": m[2], "motorTempC4": m[3],
                "vibrationX": v[0], "vibrationY": v[1], "vibrationZ": v[2],
                "batteryVoltageV": s["batteryVoltageV"],
                "batteryPct": s["batteryPct"],
                "batteryTempC": s["batteryTempC"],
                "ambientC": s["airTempC"],
                "moistureDetected": int(bool(s.get("moistureDetected", False))),
                "rainIntensity": s.get("rainIntensity", 0.0),
            }
        )  # fmt: skip
    return pd.DataFrame(out)


def verdict(bundle: dict[str, Any], feats: pd.DataFrame) -> dict[str, Any]:
    """Policy on one flight's features: which fault, how sure, hours left, and ok / watch / ground."""
    x = feats[bundle["features"]]
    clf = bundle["classifier"]
    proba = clf.predict_proba(x)[0]
    fault = str(clf.classes_[proba.argmax()])
    anomaly = bool(-bundle["anomaly"].score_samples(x)[0] > bundle["anomaly_threshold"])
    out: dict[str, Any] = {"fault": fault, "confidence": round(float(proba.max()), 3), "anomaly": anomaly}
    if fault != "none":
        rul = max(float(bundle["rul"].predict(rul_x(feats, pd.Series([fault])))[0]), 0.0)
        out["rulH"] = round(rul, 1)
        out["state"] = "ground" if rul < GROUND_RUL_H or anomaly else "watch"
    elif anomaly:
        out |= {"fault": "unknown", "state": "watch"}
    else:
        out["state"] = "ok"
    return out


def handler(event: dict[str, Any], _context: Any = None) -> dict[str, Any] | None:
    drone_id, mission_id, samples = event.get("droneId"), event.get("missionId"), event.get("samples")
    if not isinstance(drone_id, str) or not isinstance(samples, list):
        raise ValueError("event needs droneId (string) and samples (list)")  # noqa: TRY004  (the API maps it to 400)
    df = rows([s for s in samples if isinstance(s, dict)])
    if len(df) < MIN_SAMPLES:
        return None
    df["droneId"], df["missionId"] = drone_id, mission_id or "-"  # one flight, whatever the samples said
    v = verdict(model(), flight_features(df))
    if v["state"] == "ok":
        return None

    now = datetime.now(UTC)
    ts = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    health = {k: v[k] for k in ("state", "fault", "confidence", "rulH", "anomaly") if k in v} | {"checkedAt": ts}
    ev: dict[str, Any] = {
        "id": event_id(int(now.timestamp() * 1000)),
        "droneId": drone_id,
        "ts": ts,
        "type": "fault",
        "severity": "critical" if v["state"] == "ground" else "warning",
        "message": message(v),
        "health": health,
    }
    if isinstance(mission_id, str) and mission_id:
        ev["missionId"] = health["missionId"] = mission_id
    return ev


def message(v: dict[str, Any]) -> str:
    what = LABELS[v["fault"]]
    left = f", about {v['rulH']:.0f} flight-hours left" if "rulH" in v else ""
    act = "ground after landing" if v["state"] == "ground" else "inspect at the next swap"
    return f"{what}{left}: {act}"


__all__ = ["handler"]

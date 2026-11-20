"""Train the predictive-maintenance models on per-flight health features.

Three models, one bundle (`model.joblib`):
  - classifier: fault type per flight (none, bearing_wear, prop_damage, weak_cell, seal_leak)
  - rul: airborne hours until the faulty part fails
  - anomaly: Isolation Forest fitted on healthy flights only, for faults the classifier has never seen

This fits on every drone; evaluate.py scores the same recipe with 4-fold cross-validation by drone.
Runs locally or as a SageMaker script-mode training job (SM_CHANNEL_TRAIN / SM_MODEL_DIR):

    python train.py
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, IsolationForest

HERE = Path(__file__).resolve().parent
DATA = HERE.parents[1] / "ml" / "datasets" / "raw" / "predictive-maintenance"
OUT = HERE / "out"
FAULTS = ("bearing_wear", "prop_damage", "weak_cell", "seal_leak")
VISIBLE_SEV = 0.05  # below this a fault leaves no signature above sensor noise, so it trains as "none"
SEED = 7

FEATURES = [
    "motorRiseMax", "motorRiseMedian", "motorRiseSpread",
    "vibXYMean", "vibZMean", "vibXYP90", "vibXYoverZ",
    "voltsMean", "voltsMin", "battPctMean", "voltsPerPct", "packRiseMax",
    "moistRate", "rainMean", "ambientMean", "samples",
]  # fmt: skip


def flight_features(rows: pd.DataFrame) -> pd.DataFrame:
    """One row per flight (droneId, missionId): health features, plus the labels at the end of the flight when the
    rows carry them (training) - live telemetry does not (health-monitor)."""
    d = rows.copy()
    rise = d[[f"motorTempC{i}" for i in range(1, 5)]].sub(d["ambientC"], axis=0)
    d["rMax"], d["rMed"] = rise.max(axis=1), rise.median(axis=1)
    d["vXY"] = (d["vibrationX"] + d["vibrationY"]) / 2
    d["packRise"] = d["batteryTempC"] - d["ambientC"]
    g = d.groupby(["droneId", "missionId"], sort=False)
    f = pd.DataFrame(
        {
            "motorRiseMax": g["rMax"].mean(),
            "motorRiseMedian": g["rMed"].mean(),
            "vibXYMean": g["vXY"].mean(),
            "vibZMean": g["vibrationZ"].mean(),
            "vibXYP90": g["vXY"].quantile(0.9),
            "voltsMean": g["batteryVoltageV"].mean(),
            "voltsMin": g["batteryVoltageV"].min(),
            "battPctMean": g["batteryPct"].mean(),
            "packRiseMax": g["packRise"].max(),
            "moistRate": g["moistureDetected"].mean(),
            "rainMean": g["rainIntensity"].mean(),
            "ambientMean": g["ambientC"].mean(),
            "samples": g.size(),
            "ts": g["ts"].first(),
        }
    )
    if "label_fault" in d:
        f["fault"] = g["label_fault"].last()
        f["severity"] = g["label_severity"].max()
        f["rulH"] = g["label_rul_h"].min()
    f["motorRiseSpread"] = f["motorRiseMax"] - f["motorRiseMedian"]  # one motor hotter than its siblings
    f["vibXYoverZ"] = f["vibXYMean"] / f["vibZMean"].clip(lower=0.1)  # imbalance is lateral, wear is not
    # weak cell: volts drop faster per % used; covariance over variance is the least-squares slope
    cov = d.groupby(["droneId", "missionId"], sort=False)[["batteryVoltageV", "batteryPct"]].cov()
    pct_var = cov.xs("batteryPct", level=2)["batteryPct"]
    f["voltsPerPct"] = (cov.xs("batteryPct", level=2)["batteryVoltageV"] / pct_var.where(pct_var > 0)).fillna(0)
    if "fault" in f:
        f["target"] = np.where(f["severity"] >= VISIBLE_SEV, f["fault"], "none")
    return f.reset_index()


def fit(train: pd.DataFrame) -> dict:
    x = train[FEATURES]
    clf = HistGradientBoostingClassifier(class_weight="balanced", max_iter=300, random_state=SEED).fit(
        x, train["target"]
    )
    ok = train["target"] == "none"
    anomaly = IsolationForest(n_estimators=300, contamination="auto", random_state=SEED).fit(x[ok])
    healthy_scores = -anomaly.score_samples(x[ok])
    has_rul = (train["target"] != "none") & train["rulH"].notna()
    xr = rul_x(train[has_rul], train.loc[has_rul, "target"])
    rul = HistGradientBoostingRegressor(max_iter=300, random_state=SEED).fit(xr, train.loc[has_rul, "rulH"])
    return {
        "features": FEATURES,
        "classifier": clf,
        "rul": rul,
        "anomaly": anomaly,
        "anomaly_threshold": float(np.quantile(healthy_scores, 0.99)),  # 1 % false alarms on healthy flights
    }


def rul_x(f: pd.DataFrame, fault: pd.Series) -> pd.DataFrame:
    """RUL features: the health features plus the fault type (the classifier's call at inference)."""
    x = f[FEATURES].copy()
    for k in FAULTS:
        x[f"is_{k}"] = (fault.to_numpy() == k).astype(float)
    return x


def load_rows(data_dir: Path) -> pd.DataFrame:
    return pd.read_csv(data_dir / "telemetry.csv.gz")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, default=Path(os.environ.get("SM_CHANNEL_TRAIN", DATA)))
    ap.add_argument("--model-dir", type=Path, default=Path(os.environ.get("SM_MODEL_DIR", OUT)))
    a = ap.parse_args()
    a.model_dir.mkdir(parents=True, exist_ok=True)

    flights = flight_features(load_rows(a.data))
    joblib.dump(fit(flights) | {"visible_severity": VISIBLE_SEV}, a.model_dir / "model.joblib")
    flights.to_csv(a.model_dir / "flights.csv.gz", index=False)  # evaluate.py cross-validates on these
    print(f"{len(flights)} flights from {flights['droneId'].nunique()} drones")
    print(f"-> {a.model_dir / 'model.joblib'}")


if __name__ == "__main__":
    main()

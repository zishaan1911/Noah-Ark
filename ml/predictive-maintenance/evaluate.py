"""Score the training recipe with 4-fold cross-validation by drone and write out/metrics.json.

Each fold refits all three models without a quarter of the drones, then predicts those drones, so every
flight is scored by models that never saw its drone.

    python evaluate.py
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix, mean_absolute_error, roc_auc_score
from sklearn.model_selection import GroupKFold

from train import FAULTS, OUT, fit, rul_x

BINS = [0.0, 0.05, 0.3, 0.7, 1.01]
BIN_NAMES = ["<0.05", "0.05-0.3", "0.3-0.7", ">=0.7"]


FOLDS = 4


def out_of_fold(flights: pd.DataFrame) -> pd.DataFrame:
    """Every flight with its class prediction, anomaly score and alarm, and RUL prediction from unseen-drone models."""
    parts = []
    for tr, te in GroupKFold(FOLDS).split(flights, groups=flights["droneId"]):
        b, test = fit(flights.iloc[tr]), flights.iloc[te].copy()
        x = test[b["features"]]
        test["pred"] = b["classifier"].predict(x)
        test["score"] = -b["anomaly"].score_samples(x)
        test["alarm"] = test["score"] > b["anomaly_threshold"]
        test["rulPred"] = b["rul"].predict(rul_x(test, test["target"]))  # true fault type: scores the regressor alone
        parts.append(test)
    return pd.concat(parts)


def evaluate(test: pd.DataFrame) -> dict:
    labels = ["none", *FAULTS]
    report = classification_report(test["target"], test["pred"], labels=labels, output_dict=True, zero_division=0)

    faulty = test[test["fault"] != "none"].copy()
    faulty["bin"] = pd.cut(faulty["severity"], BINS, labels=BIN_NAMES, right=False)
    # recall by severity: did we name the right fault, by how far it had progressed
    by_sev = {
        k: {
            b: round(float((g["pred"] == g["fault"]).mean()), 3)
            for b, g in faulty[faulty["fault"] == k].groupby("bin", observed=True)
        }
        for k in FAULTS
    }

    score, alarm = test["score"].to_numpy(), test["alarm"].to_numpy()
    healthy = (test["fault"] == "none").to_numpy()
    worn = (test["severity"] >= 0.3).to_numpy()
    anomaly = {
        "auroc_sev0.3_vs_healthy": round(float(roc_auc_score(worn[healthy | worn], score[healthy | worn])), 3),
        "false_alarm_rate": round(float(alarm[healthy].mean()), 4),
        "detection_by_fault_sev0.3": {
            k: round(float(alarm[worn & (test["fault"] == k).to_numpy()].mean()), 3) for k in FAULTS
        },
    }

    r = test[(test["target"] != "none") & test["rulH"].notna()]
    rul = {"flights": len(r)}
    if len(r):
        pred = r["rulPred"].to_numpy()
        late = (r["rulH"] <= 10).to_numpy()
        rul |= {
            "mae_h": round(float(mean_absolute_error(r["rulH"], pred)), 2),
            "mae_h_last_10h": round(float(mean_absolute_error(r["rulH"][late], pred[late])), 2),
            "median_true_rul_h": round(float(r["rulH"].median()), 2),
        }

    return {
        "folds": FOLDS,
        "flights": len(test),
        "fault_cycles": {k: flights_cycles(test, k) for k in FAULTS},
        "classifier": {
            "macro_f1": round(report["macro avg"]["f1-score"], 3),
            "per_class": {
                k: {m: round(report[k][m], 3) for m in ("precision", "recall", "f1-score")}
                | {"n": report[k]["support"]}
                for k in labels
            },
            "recall_by_severity": by_sev,
            "confusion": {
                "labels": labels,
                "matrix": confusion_matrix(test["target"], test["pred"], labels=labels).tolist(),
            },
        },
        "anomaly": anomaly,
        "rul": rul,
    }


def flights_cycles(test: pd.DataFrame, kind: str) -> int:
    """Distinct fault cycles of one kind in the test set: a new cycle starts when severity drops."""
    n = 0
    for _, g in test[test["fault"] == kind].sort_values("ts").groupby("droneId"):
        n += 1 + int((np.diff(g["severity"].to_numpy()) < -0.5).sum())
    return n


def main() -> None:
    m = evaluate(out_of_fold(pd.read_csv(OUT / "flights.csv.gz")))
    (OUT / "metrics.json").write_text(json.dumps(m, indent=1))
    print(json.dumps({k: m[k] for k in ("flights", "fault_cycles", "anomaly", "rul")}, indent=1))
    c = m["classifier"]
    print("macro F1", c["macro_f1"])
    for k, v in c["per_class"].items():
        print(f"  {k:13s} P {v['precision']:.3f}  R {v['recall']:.3f}  F1 {v['f1-score']:.3f}  n {v['n']}")
    print("recall by severity", json.dumps(c["recall_by_severity"]))


if __name__ == "__main__":
    main()

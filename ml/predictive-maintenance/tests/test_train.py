import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import train as t


def flight(drone: str, mission: str, hot_motor: float, volts_per_pct: float, fault: str, sev: float) -> pd.DataFrame:
    n = 10
    pct = np.linspace(90, 80, n)
    return pd.DataFrame(
        {
            "droneId": drone,
            "missionId": mission,
            "ts": [f"2026-01-01T00:00:{i:02d}Z" for i in range(n)],
            "ambientC": 30.0,
            "motorTempC1": 55.0 + hot_motor,
            "motorTempC2": 55.0,
            "motorTempC3": 55.0,
            "motorTempC4": 55.0,
            "vibrationX": 6.0,
            "vibrationY": 6.0,
            "vibrationZ": 8.0,
            "batteryVoltageV": 46.0 + volts_per_pct * (pct - 85),
            "batteryPct": pct,
            "batteryTempC": 40.0,
            "moistureDetected": 0,
            "rainIntensity": 0.0,
            "payloadKg": 2.0,
            "label_fault": fault,
            "label_severity": sev,
            "label_rul_h": np.nan,
        }
    )


def test_flight_features():
    rows = pd.concat(
        [
            flight("ARK-101", "msn_a", 0.0, 0.05, "none", 0.0),
            flight("ARK-101", "msn_b", 20.0, 0.12, "bearing_wear", 0.6),
            flight("ARK-102", "msn_c", 0.0, 0.05, "weak_cell", 0.01),  # too early to see: trains as none
        ]
    )
    f = t.flight_features(rows).set_index("missionId")
    assert f.loc["msn_a", "motorRiseSpread"] == pytest.approx(0)
    assert f.loc["msn_b", "motorRiseSpread"] == pytest.approx(20)  # max 45 K over a median of 25 K
    assert f.loc["msn_a", "voltsPerPct"] == pytest.approx(0.05)
    assert f.loc["msn_b", "voltsPerPct"] == pytest.approx(0.12)
    assert list(f["target"]) == ["none", "bearing_wear", "none"]
    assert set(t.FEATURES) <= set(f.columns)

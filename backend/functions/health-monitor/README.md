# health-monitor

Scores each finished flight with the predictive-maintenance models (`ml/predictive-maintenance`). When a drone
needs attention it returns a `fault` drone-event carrying `health`:
- **`watch`:** keep flying, inspect at the next swap.
- **`ground`:** maintenance after landing, and dispatch skips the drone.

**Why Python:** it is ML inference (scikit-learn now, a SageMaker endpoint later), and it reuses the training
feature code, `flight_features`, so training and serving can't drift apart.

## Policy
| Classifier | Anomaly detector | Hours left (RUL) | Verdict |
|---|---|---|---|
| none | no | | nothing sent |
| none | yes | | `watch`, fault `unknown` |
| a fault | no | ≥ 8 h | `watch` |
| a fault | yes, or | < 8 h | `ground` |

Flights with fewer than 10 health samples are not scored.

## Event shape
In: `{"droneId": "ARK-104", "missionId": "msn_…", "samples": [telemetry, …]}`. These are the messages of
one flight, with `motorTempC`, `vibration`, `batteryVoltageV`, `batteryTempC` and `airTempC`.

Out: a `drone-event` (see `shared/examples/drone-event/valid-health-fault.json`) or `None`.

## Run
```
cd ml/predictive-maintenance && python generate.py && python train.py     # once: builds out/model.joblib
cd backend/functions/health-monitor
pip install -r requirements.txt
python local.py --broker localhost:1883                                    # or: docker compose up health
```
`local.py` stands in for the IoT rule and Lambda. It does three things:
1. Buffers `ark/+/telemetry` per drone.
2. Scores a flight when the drone disarms or starts a new mission.
3. Publishes the verdict on `ark/<droneId>/events`.

The fleet sim (`simulation/ark_fleet`) listens there and grounds the drone.

## Test
```
ruff check . && ruff format --check . && pytest
```
The two model tests need `out/model.joblib` and skip without it. They fly the fleet sim with injected faults
through the real models. The last one runs the whole loop with no broker: sim → monitor → registry, ending
with the drone grounded and out of dispatch.

## Shortcuts
- **Model in-process:** it is loaded with joblib from `MODEL_PATH`, with scikit-learn pinned to the
  training version. Move it to a SageMaker endpoint with the CDK `ai` stack.
- **Feature code from the repo path:** `train.py` is imported from the repo. Package it into the Lambda zip
  when deploying.
- **Hours left in live mode:** the fleet sim runs wear 100× faster, so in live mode `rulH` is model hours,
  not wall-clock hours.

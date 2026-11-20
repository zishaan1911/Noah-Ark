# Predictive maintenance

This package spots failing motors, packs and seals from the telemetry the drone already streams. It has
three parts:
1. `generate.py` writes a labelled dataset from the fleet sim with injected faults.
2. `train.py` fits three models on per-flight features.
3. `evaluate.py` scores them with cross-validation by drone.

## What it does
`generate.py` flies the fleet sim (`simulation/ark_fleet`: 24 drones, 6 hubs, real dispatch) and adds what
that sim does not model, using the Ark-1 constants from `simulation/ark_sim/model.py`:

| Signal | Model |
|---|---|
| `motorTempC[4]` | First-order thermal model per motor. Heat comes from copper loss (torque / kt)² R and iron loss. Cooling is through prop wash and is stronger in rain. A healthy motor runs about 25 K over ambient in hover. |
| `batteryTempC` | Pack I²R heating. The hub swaps in a rested pack at each landing. |
| `batteryVoltageV` | Open-circuit voltage at the state of charge, minus I × R_pack |
| `vibration[3]` | ArduPilot VIBE-style m/s², scaling with ω², with log-normal and Gaussian noise |
| `moistureDetected` | Rare condensation hits in heavy rain |
| ambient, rain | Diurnal curve (Sabah, UTC+8) and afternoon showers per hub |

Faults: one at a time per drone. Severity grows as ((t − onset) / life)² over 2 to 6 days. The part is
replaced at failure, then the drone has a healthy spell of about 4 days before the next fault.

| `label_fault` | Signature at severity 1 |
|---|---|
| `bearing_wear` (one motor) | +0.25 N·m friction: that motor runs about 40 K hotter, and broadband vibration rises by 12 m/s² on all axes |
| `prop_damage` (one motor) | Imbalance adds 25 m/s² to x and y at hover speed. Motor temperatures are unchanged. |
| `weak_cell` | Pack resistance × 3 and capacity −30 %: about 3.5 V more sag in hover, a pack about 12 K hotter, and the voltage falls faster |
| `seal_leak` | `moistureDetected` reads true on about 10 % of samples when dry (humid air gets in) and about 90 % in heavy rain |

## Output: `ml/datasets/raw/predictive-maintenance/` (git-ignored)
- **`telemetry.csv.gz`:** one row every 30 s while airborne.
  - Columns from the telemetry schema, flattened: `motorTempC1..4`, `vibrationX/Y/Z`.
  - Context columns:
    - `phase`
    - `payloadKg`
    - `ambientC`
    - `flightH`, the drone's cumulative airborne hours
  - Label columns:
    - `label_fault`
    - `label_fault_id` (`<droneId>#<n>`)
    - `label_motor`
    - `label_severity`
    - `label_rul_h`: airborne hours to failure. It is blank when the fault is still growing at the end of the run (censored).
- **`faults.json`:** the injected schedule, which is the ground truth.

The training features should stay within what the drone streams today. Motor current is internal to the
generator, because it isn't in the telemetry contract.

## Models (`train.py` → `out/model.joblib`)
Each flight becomes one row of 17 features:
- **Motors:** the temperature over ambient of the hottest motor and of the median motor, and the gap
  between them (one motor hotter than its siblings).
- **Vibration:** x/y mean, z mean, x/y 90th percentile, and x/y over z (imbalance is sideways, worn
  bearings are not).
- **Pack:** mean and minimum voltage, the volts-per-% slope within the flight, and the pack temperature rise.
- **Moisture and context:** moisture rate, rain, payload, ambient temperature, sample count.

The flight's label is its fault at the end of the flight. A fault below severity 0.05 leaves nothing above
the sensor noise, so it trains as `none`.

| Model | What it answers | Algorithm |
|---|---|---|
| `classifier` | Which fault, if any? | HistGradientBoosting, balanced class weights |
| `rul` | Airborne hours until the part fails | HistGradientBoosting regressor on faulty flights; the fault type is an input |
| `anomaly` | Is this flight unlike healthy ones? (backstop for faults never seen) | Isolation Forest on healthy flights, alarm at their 99th percentile |

`train.py` reads `SM_CHANNEL_TRAIN` and `SM_MODEL_DIR` when set, so it runs unchanged as a SageMaker
script-mode job (sklearn container).

## Metrics (`evaluate.py`, 4-fold cross-validation grouped by drone, 14,155 flights, 2026-11-20)
Each fold refits on 18 drones and scores the other 6, so no drone is ever scored by a model that saw it.

**Classifier: macro F1 0.925**

| Class | Precision | Recall | Flights |
|---|---|---|---|
| none | 0.952 | 0.971 | 9551 |
| bearing_wear | 0.986 | 0.995 | 1303 |
| prop_damage | 0.984 | 0.995 | 1176 |
| weak_cell | 0.982 | 0.954 | 901 |
| seal_leak | 0.783 | 0.659 | 1224 |

- **Recall at severity 0.05–0.3**, early in a fault's life:
  - bearing wear 0.99
  - prop damage 0.99
  - weak cell 0.90
  - seal leak 0.44
- **Seal leak:** recall is 0.89 on rainy flights and 0.65 on dry ones, because the moisture sensor is the
  only signal.

**RUL:**
- MAE 10.1 h overall, against a median true remaining life of 18.2 h.
- MAE 5.4 h when the failure is within 10 h.

**Anomaly detector:**
- AUROC 0.93 for severity ≥ 0.3 against healthy flights, with 0.9 % false alarms.
- It catches every severe bearing fault but only 23 % of prop faults and almost none of the weak-cell or
  seal faults. So it is a backstop; the classifier does the work.

These numbers are on simulated faults. Read them as "the features carry the signal". They are not a
claim about real drones (see Known gaps).

## Run and test
```
pip install -r requirements-dev.txt
python generate.py --days 14 --seed 7        # ~7 min on one core, ~20 MB
python train.py                              # ~25 s
python evaluate.py                           # writes out/metrics.json
ruff check . && ruff format --check . && pytest
```

## Known gaps
- **Thermal constants are estimates:** motor heat capacity, the R_th values and the iron-loss fraction.
  They are tuned to a plausible 25 K rise, not measured on an MN801-S.
- **Simplified faults:** each fault grows as a smooth quadratic, and only one is active per drone at a time.
  Real wear is noisier and faults can coincide.
- **Pack rotation:** a weak cell follows the drone, not a pack serial.
- **No water landings:** fleet flights never land on water, so a seal leak never meets open water here.
- **Easy separation:** each simulated fault has one clean signature, which is why recall is near 1.
  Expect lower scores on real data, where faults overlap and sensors drift.
- **No motor localisation:** the classifier says "bearing wear", not which motor; the hottest motor is the
  obvious hint. Prop damage can't be localised from one body IMU.
- **RUL scored on the true fault type:** in service it gets the classifier's call, which names the right fault on about
  90 % of flights once a fault is visible (seal leaks pull it down).
- **Not deployed:** there is no SageMaker endpoint or `inference.py` yet, and there are no AWS credentials
  on this machine.
- **Not checked against real data yet.** See `ml/datasets/predictive-maintenance.md` for the external sets.

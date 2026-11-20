# Predictive maintenance: dataset generator

This package produces labelled health telemetry for the motor, battery and seal fault model. It holds the
dataset only for now. Training (`train.py`, SageMaker) comes later.

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
| `seal_leak` | `moistureDetected` reads true about 90 % of the time in heavy rain |

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

## Run and test
```
pip install -r requirements-dev.txt
python generate.py --days 14 --seed 7        # ~7 min on one core, ~20 MB
ruff check . && ruff format --check . && pytest
```

## Known gaps
- **Thermal constants are estimates:** motor heat capacity, the R_th values and the iron-loss fraction.
  They are tuned to a plausible 25 K rise, not measured on an MN801-S.
- **Simplified faults:** each fault grows as a smooth quadratic, and only one is active per drone at a time.
  Real wear is noisier and faults can coincide.
- **Pack rotation:** a weak cell follows the drone, not a pack serial.
- **No water landings:** fleet flights never land on water, so the seal leak only shows in rain.
- **Not checked against real data yet.** See `ml/datasets/predictive-maintenance.md` for the external sets.

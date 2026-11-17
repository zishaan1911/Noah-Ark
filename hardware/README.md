# Hardware
Design and simulation only (no physical build). Reference design: `../slipstream` (Gannet SX-01).

| Path | What it is |
|---|---|
| `ark.json` | Single source of truth: requirements, candidate parts, and the chosen config (written by `sizing/`) |
| `sizing/size_ark.py` | Searches power set x cell x pack size, keeps the lightest Ark that flies the mission and floats |
| `sizing/hull.py` | Ellipsoid float hull: volume, draft, centre of buoyancy, roll stability (GM) |
| `electronics/spice/` | ngspice power chain: pack + harness + bus under surge, ESC + BLDC at hover; writes `power_chain` to `ark.json` |
| `electronics/bom.md` | Bill of materials, filled from `ark.json` |
| `electronics/schematics/`, `electronics/pcb/` | Schematics and PCB layouts (later) |
| `mechanical/` | Airframe, seals, payload release (later) |

## Ark-1 (from `ark.json`)
Quad X with fixed arms on a sealed ellipsoid hull that is also its float.

| | |
|---|---|
| Mission | 20 km out with 2 kg, drop, 20 km back, 20 % reserve, 2 min water landing + take-off |
| All-up mass | 13.2 kg (pack 5.7, power set 2.2, payload 2.0, fixed avionics 1.6, hull 1.2, arms 0.5) |
| Propulsion | 4x 8108-class 120 KV motors, 26" props, 12S; thrust-to-weight 3.2 |
| Pack | 12S6P Li-ion 21700 (5 Ah cells), 1.30 kWh, peak 102 A |
| Size | 1.69 m tip to tip; hull 0.56 x 0.39 x 0.23 m, 26 L |
| Flight | 41 min; cruise 19 m/s out, 18 m/s back; hover 1.56 kW loaded |
| On water (loaded) | Draft 0.11 m, GM 0.068 m, prop clearance 0.26 m |

### Power chain (ngspice, `ark.json` -> `power_chain`)
| Check | Result | Limit |
|---|---|---|
| Hover rotor | 2565 rpm, 311 W shaft per rotor | |
| ESC + motor at hover, 20 % pack (40 V) | duty 0.625, efficiency 0.885 | duty <= 0.85; efficiency >= 0.8 (sizing's assumption) |
| Bus at peak current, full pack | 45.1 V min (3.76 V/cell) | >= 2.8 V/cell under load |
| Bus at peak current, 20 % pack | 35.9 V min (2.99 V/cell) | >= 2.8 V/cell under load |

The 20 % case sits just under 3.0 V/cell, so the BMS and the flight controller's battery failsafe must use a
load-compensated cutoff (2.8 V/cell under surge), not a 3.0 V resting one.

## Run
```bash
pip install -r requirements.txt
python sizing/size_ark.py            # solve and write 'chosen' to ark.json
python sizing/size_ark.py --dry-run  # solve and print only
python electronics/spice/run_spice.py  # power chain in ngspice (~1 min), after sizing; needs ngspice on PATH or NGSPICE
```
Change a requirement or a candidate part in `ark.json`, rerun, and the chosen config follows.

## Test
```bash
ruff check . && ruff format --check . && pytest
```

## Model limits
- Power: momentum theory + figure of merit, Glauert forward-flight inflow, flat-plate drag. Part figures are
  datasheet-class estimates (expect +/- 15 % on power).
- Water: calm, fresh water. No waves, wind heel, rain load or water take-off dynamics yet.
- Motors are open-frame brushless (they tolerate rain); only the hull is sealed (IP67).
- SPICE: six-step trapezoidal ESC at a fixed rotor speed (real FOC ESCs are a few % better); motor R/L, pole
  pairs and prop thrust coefficient are class estimates. The live ngspice test is skipped if ngspice is missing.

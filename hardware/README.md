# Hardware
Design and simulation only (no physical build). Reference design: `../slipstream` (Gannet SX-01).

| Path | What it is |
|---|---|
| `ark.json` | Single source of truth: requirements, candidate parts, and the chosen config (written by `sizing/`) |
| `sizing/size_ark.py` | Searches power set x cell x pack size, keeps the lightest Ark that flies the mission and floats |
| `sizing/hull.py` | Ellipsoid float hull: volume, draft, centre of buoyancy, roll stability (GM) |
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

## Run
```bash
pip install -r requirements.txt
python sizing/size_ark.py            # solve and write 'chosen' to ark.json
python sizing/size_ark.py --dry-run  # solve and print only
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

# Hardware
Design and simulation only (no physical build). Reference design: `../slipstream` (Gannet SX-01).

| Path | What it is |
|---|---|
| `ark.json` | Single source of truth: requirements, candidate parts, and every result the scripts write back |
| `sizing/size_ark.py` | Searches power set x cell x pack size, keeps the lightest Ark that flies the mission and floats. Calls `mechanical/mech.py` per candidate for the arm tube and the packaging |
| `sizing/hull.py` | Ellipsoid float hull: volume, draft, centre of buoyancy, roll stability (GM) |
| `mechanical/mech.py` | Arm tube (strength, stiffness, mode vs rotor 1P), internal packaging, clamshell O-ring seal, cable glands, payload release |
| `mechanical/cad.py` | Concept CAD as closed binary STL meshes in `mechanical/cad/` (hull, frame, props, pod, skids, internals, assembly) |
| `electronics/spice/` | ngspice power chain: pack + harness + bus under surge, ESC + BLDC at hover |
| `electronics/bom.md` | Bill of materials, filled from `ark.json` |

## Ark-1 (from `ark.json`)
Quad X. A sealed ellipsoid clamshell hull (glass-fibre, RF-transparent) floats the drone; the two halves bolt at an
equator flange that also takes the four carbon arms. Motors sit on pylons so the props stay clear of the water. The
2 kg payload rides in its own drop pod on a release hook under the hull, between two landing skids.

| | |
|---|---|
| Mission | 20 km out with 2 kg, drop, 20 km back, 20 % reserve, 2 min water landing + take-off |
| All-up mass | 13.9 kg (pack 5.71, power set 2.16, fixed avionics + skids + seals 2.02, payload 2.0, hull 1.24, arms 0.76) |
| Propulsion | 4x 8108-class 120 KV, 26" props, 12S; thrust-to-weight 3.0 |
| Pack | 12S6P Li-ion 21700 (5 Ah cells), 1.30 kWh; energy margin 1.005 over mission + reserve |
| Size | 1.69 m tip to tip; hull 0.58 x 0.40 x 0.23 m, 28 L |
| Flight | 38 min at 20 m/s; hover 1.69 kW loaded |
| Arms | 38 x 1 mm carbon tube, 0.28 m free; first mode 96 Hz, above the 25-92 Hz rotor band; strength SF 22 |
| On water (loaded) | Draft 0.115 m, GM 0.099 m, prop clearance 0.26 m |
| Seal | 3.53 mm O-ring, 1.50 m long, gland 2.65 x 4.93 mm (25 % squeeze, 75 % fill), 25 bolts; IP67 |

### Power chain (ngspice, `ark.json` -> `power_chain`)
| Check | Result | Limit |
|---|---|---|
| Hover rotor | 2636 rpm, 338 W shaft per rotor | |
| ESC + motor at hover, 20 % pack (39.8 V) | duty 0.649, efficiency 0.886 | duty <= 0.85; efficiency >= 0.8 (sizing's assumption) |
| Bus at peak current, full pack | 44.7 V min (3.73 V/cell) | >= 2.8 V/cell under load |
| Bus at peak current, 20 % pack | 35.5 V min (2.96 V/cell) | >= 2.8 V/cell under load |

The 20 % case sits under 3.0 V/cell, so the BMS and the flight controller's battery failsafe must use a
load-compensated cutoff (2.8 V/cell under surge), not a 3.0 V resting one.

## Run
Run in this order; each step reads what the one before wrote to `ark.json`.
```bash
pip install -r requirements.txt
python sizing/size_ark.py              # size (with arm tube + packaging per candidate), write 'chosen'
python mechanical/mech.py              # arm, packaging, seal and release report -> mechanical_design
python electronics/spice/run_spice.py  # power chain in ngspice (~1 min); needs ngspice on PATH or NGSPICE
python mechanical/cad.py               # STL meshes
```
Add `--dry-run` to the first three to print without writing.

## Test
```bash
ruff check . && ruff format --check . && pytest
```
Tests also fail if a step's stored results are stale (for example sizing changed but SPICE was not rerun).

## Model limits
- Power: momentum theory + figure of merit, Glauert forward-flight inflow, flat-plate drag (arms by the cross-flow
  principle). Part figures are datasheet-class estimates (expect +/- 15 % on power).
- Water: calm, fresh water. Loaded, the waterline sits at the flange, so the arms roots and seal are wetted;
  waves, wind heel and water take-off (suction on the arms and pod) are for the phase 5 simulation.
- Arms: a cantilever from the flange with the motor as a tip mass; pylon torsion and arm torsion modes are not checked.
- Motors are open-frame brushless (they tolerate rain); only the hull is sealed.
- SPICE: six-step trapezoidal ESC at a fixed rotor speed (real FOC ESCs are a few % better); motor R/L, pole
  pairs and prop thrust coefficient are class estimates. The live ngspice test is skipped if ngspice is missing.

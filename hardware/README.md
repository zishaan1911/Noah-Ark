# Hardware
Design and simulation only (no physical build). Reference design: `../slipstream` (Gannet SX-01).
Ark-1's airframe is the team's drone model, turned into Ark by scripts. The detail is in
`industrial-design/README.md`, and the 3D page is at https://claude.ai/artifact/QkDvBwiLNF4JMxze58t72x.

| Path | What it is |
|---|---|
| `ark.json` | Single source of truth: requirements, candidate parts, and every result the scripts write back |
| `sizing/size_ark.py` | First-pass sizing: sweeps real motor, prop and cell candidates and writes `chosen` (power set and cell) |
| `industrial-design/` | The airframe, mass budget, mission check on the real drag, harness, pontoons and 3D viewer |
| `flight/` | ArduPilot params and the Lua script that fires the pontoons |
| `../simulation/` | Phase 5: Ark-1 flown in ArduCopter SITL (water landing, failed tube, water take-off, ditching) |
| `electronics/spice/` | ngspice power chain: pack + harness + bus under surge, ESC + BLDC at hover |
| `electronics/bom.md` | Bill of materials, filled from `ark.json` |
| `sizing/hull.py`, `mechanical/` | The earlier concept (ellipsoid hull, carbon arms, STL CAD). It was replaced by the team's airframe and is kept only because sizing still imports it |

## Ark-1 (from `ark.json` -> `industrial_design`)
Quad X built on the team's airframe. The gimbal is removed and a rear hatch closes the old battery bay. The pack
sits in the belly well inside the hub, and the 2 kg payload hangs in a pod on a cargo connector. Two inflatable
pontoons deploy from the skids before a water touchdown.

| | |
|---|---|
| Mission | 20 km out with 2 kg, drop, 20 km back, 20 % reserve |
| All-up mass | 16.19 kg: pack 6.67, electrical parts 3.26, structure 2.43, payload 2.0, pontoon kit 1.16, mounting 0.25, props 0.24, copper 0.19 |
| Propulsion | 4 x T-Motor MN801-S KV120, G28 x 9.2 props, 12S; thrust-to-weight 2.59 |
| Pack | 12S7P, 84 x Samsung 50S (21700, 5 Ah), 1.51 kWh; energy margin 1.08 over mission + reserve |
| Drag | Frontal area 0.182 m² rasterised from the mesh, Cd 0.9 (estimate) |
| Electronics | 51 parts, 75 wires (`industrial-design/harness.json`): Pixhawk 6X, Jetson, Holybro PM08D, AMASS AS150U |
| On water | 2 x 16.8 L pontoons (1.0 m x 150 mm), 107 % reserve buoyancy, draft 73 mm, prop clearance 0.44 m |

`sizing/size_ark.py` alone picks 12S4P, because it uses an idealised hull drag. The mission check on the real
airframe (`industrial-design/mission_check.py`) needs 12S7P, and that is the pack the design uses.

### Power chain (ngspice, `ark.json` -> `power_chain`)
| Check | Result | Limit |
|---|---|---|
| Hover rotor | 2392 rpm, 333 W shaft per rotor | |
| ESC + motor at hover, 20 % pack (40.1 V) | duty 0.59, efficiency 0.86 | duty <= 0.85; efficiency >= 0.85 (sizing's assumption) |
| Bus at peak current (90 A), full pack | 45.9 V min (3.82 V/cell) | >= 2.8 V/cell under load |
| Bus at peak current (109 A), 20 % pack | 36.5 V min (3.04 V/cell) | >= 2.8 V/cell under load |

The BMS and the flight controller's battery failsafe use a load-compensated cutoff (2.8 V/cell under surge), not a
3.0 V resting one.

## Run
From `hardware/`. Each step reads what the one before wrote to `ark.json`.
```bash
pip install -r requirements.txt
python sizing/size_ark.py              # power set and cell -> chosen
```
Then follow the run order in `industrial-design/README.md` (airframe, mission check, pontoons, SPICE, harness,
viewer). SPICE needs ngspice on PATH or `NGSPICE`.

## Test
```bash
ruff check . && ruff format --check . && pytest
```
Tests also fail if a step's stored results are stale (for example the mass changed but SPICE was not rerun).

## Model limits
- Power: momentum theory with a figure of merit and Glauert forward-flight inflow. Part figures are datasheet-class
  (expect +/- 15 % on power).
- Some part sizes and masses are not published by the maker and are marked `estimated` in `harness.json` and
  `pontoon_system.json`. Inflation timing is a model until bench-tested.
- Water: sized in calm, fresh water; waves, wind and the water take-off are flown in `../simulation/`, which
  lengthened the pontoons to 1.0 m for pitch stability.
- SPICE: six-step trapezoidal ESC at a fixed rotor speed (real FOC ESCs are a few % better). Motor R/L, pole pairs
  and the prop thrust coefficient are class estimates. The live ngspice test is skipped if ngspice is missing.

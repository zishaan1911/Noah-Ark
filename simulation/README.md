# Simulation (phase 5): Ark-1 in ArduPilot SITL

Ark-1 flies in the **official ArduCopter 4.7.2 SITL build** with the **real pontoon Lua script and params** from
`../hardware/flight/`. The world is our own physics (`ark_sim/`), connected through ArduPilot's JSON interface:
every SITL loop sends the four ESC PWMs over UDP, and the physics answers with the vehicle state. The autopilot, EKF,
LAND / RTL / battery-failsafe logic and the Lua script all run unchanged.

Everything physical comes from the hardware design. Nothing is hard-coded:

| Physics | From |
|---|---|
| Mass 16.19 kg, CG, inertia | every part's mass and position in `harness.json`, plus the `ark.json` mass budget |
| Rotors | G28 CT fit and the hover shaft power (`ark.json` → `electrical`, `power_chain`) |
| Motors and ESCs | MN801-S KV120 back-EMF, 80 mΩ, 1.1 A idle; ESC duty capped at 0.85 |
| Pack | 12S7P Samsung 50S: OCV curve and sag through the cell R0 + R1 |
| Drag | CdA from `mission_check` (rasterised frontal area, Cd 0.9) |
| Pontoons | tube size from `ark.json`, inflation time from `pontoon_system.json` (nominal 30 °C case), buoyancy by slices |
| Radar | range from the radar's mount to the wave surface, sent to SITL as `rng_1` |
| Pressure switches and relays | SITL GPIO (`SIM_PIN_MASK`), remapped to pins 0..4 by `params/ark1-sitl.parm` |

The world is a river bank 0.5 m above the water (land south of 40 m north, water beyond). It has sum-of-sines waves
(significant height Hs, deep-water dispersion), wind with Ornstein-Uhlenbeck gusts, and skid contact on the ground.

## Scenarios
| Name | What it proves |
|---|---|
| `water_landing` | Planned water landing in 0.3 m waves and 4 m/s wind: fire at the script's height, both tubes up before touchdown, floats level, props clear |
| `one_side_fails` | Left inflator jammed: one retry, the landing is aborted to a GUIDED hold, then the operator diverts it home with RTL |
| `water_takeoff` | Floating on the tubes after a landing (kit fired): takes off from 0.3 m waves in 6 m/s wind, flies, and lands on the water again |
| `ditching` | Battery failsafe over the river with no planned water landing and no companion water flag: fires and floats |

Results: `results/<name>.json` holds the track at 10 Hz, the autopilot's messages and the checks. A summary goes
into `../hardware/ark.json` → `simulation.result`. The Ark-1 viewer's **Water landing** button replays the real
`water_landing` run, and the side panel lists every scenario.

## Run
Docker (the SITL binary is Linux):
```bash
docker build -t noah-ark-sitl simulation
docker run --rm -v "$PWD:/repo" -w /repo/simulation noah-ark-sitl python -m ark_sim.scenarios all
```
Each scenario takes about 1-2 min. SITL runs in lockstep with the physics (1200 Hz), as fast as Python allows.
Then rebuild the viewer: `python hardware/industrial-design/build_viewer.py`.

## Live mode
`python -m ark_sim.live --broker broker:1883 --drone ARK-006 [--lat 5.7346 --lon 115.9302] [--speedup 1]` keeps one
SITL running for Ark Command. It spawns at the given point (default Papar, Sabah) and respawns on MQTT
`sim/<drone>/spawn {"lat","lon"}`, refused while the drone is armed. The ground is real AWS Terrain Tiles
(`ark_sim/terrain.py`, cached in `.cache/terrain/`) and the wind is the current Open-Meteo wind. SITL boots with
`params/ark1-live.parm` layered on `ark1-sitl.parm` (400 Hz, 17 m/s cruise, arm in AUTO, RTL at 60 m) and blocks until
a gateway connects to `tcp:<sim>:5760`. Progress is the retained `sim/<drone>/status`; the real-time factor prints
every 10 s. Rivers and lakes are not water on real terrain (`shortcut:` in `physics.py`).

## Test
```bash
pip install -r requirements.txt
ruff check . && ruff format --check . && pytest
```
`test_physics.py` checks the model against the hardware design: mass, hover rotor speed, rest on the pad, the design
draft, pitch righting, and inflation timing. `test_scenarios.py` checks that every stored SITL run passed **and was
flown on the current design**: it fails when the mass has changed since the run, so re-run the scenarios.

## What the simulation found (and fixed)
- **Pitch stability on the water.** The first tubes (0.66 m × 190 mm) were sized for buoyancy and roll only. The
  sim showed a pitch righting moment that peaked at about 3 N m and turned capsizing past 25°: the CG sits 0.28 m
  above the tubes. The drone pitched over in 0.3 m waves. The tubes are now 1.0 m × 150 mm with the same volume, so
  righting holds to about 40° and the drone rides 0.5 m waves (`hardware/ark.json` → `pontoon.length_note`).
- **Lua on ArduPilot 4.7.** `rangefinder:distance_cm_orient` is deprecated in 4.7, and calling it fails pre-arm,
  so the drone would never arm. The script now uses `distance_orient` (metres), and the generated params use
  `RNGFND1_MAX`.
- **The abort hold descended into the water.** On a failed tube the script held in LOITER. Ark-1 flies with no
  pilot radio, so LOITER read the missing throttle stick as full down: the drone dropped at 2.5 m/s onto its one
  good tube and rolled to 71°. The hold is now GUIDED, which keeps position and height on entry.
- **Water take-off was blocked.** After a water landing `PONT_FIRED = 1` latched the pre-arm check, so the drone
  could not leave the water. A fired kit with both tubes still holding pressure now passes; a spent, soft kit still
  blocks.

## Limits
- Water: no added mass, no hull slamming, no prop wash on the surface. Damping is a linear estimate plus quadratic
  drag. No water suction at take-off.
- Structure inertia: the shell's 2.4 kg is split by eye into hub, arms and legs (a mesh integral would be exact).
- SITL GPIO pins are 0..4, not the FMU's AUX3..7 (SITL has 16 pins), and the switch bits are written over MAVLink,
  so a relay edge inside a ~50 ms write could in principle be lost (`shortcut:` in `ark_sim/bridge.py`).
- The attitude gains are a sim starting point, not flight-tuned values. No sensor noise beyond SITL's defaults.

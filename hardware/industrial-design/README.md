# Ark-1 industrial design

Ark-1's airframe is the team's drone model (`drone-model/Drone.obj`), turned into Ark by scripts. Everything the 3D
viewer shows is generated from data here and in `../ark.json`.

| Path | What it is |
|---|---|
| `drone-model/` | The team's model (3ds Max OBJ, cm) and its UV layout. `drone.npz` is a cache (git-ignored) |
| `obj_to_npz.py` | OBJ -> per-part mesh cache |
| `ark_from_model.py` | Scale to Ark's arm radius, remove the gimbal, close the old battery bay with a hatch, fit the pack in the belly well, build the mass budget from the real parts, size the pontoons for the buoyancy reserve |
| `mission_check.py` | 20 km out / 20 km back mission on this airframe's own drag (rasterised frontal area); finds the smallest pack that closes it |
| `harness.json` | Every electrical part, port and wire (single source of truth; edit this file) |
| `harness.py` | Checks the harness: connections, voltage domains, wire gauge and connector ratings against the current, every part and route inside the shell; writes `checks` |
| `pontoon_system.py` | Inflatable pontoons: CO2 gas, inflation timing, fabric, firing, one-side failure; writes `pontoon_system.json` and `../flight/pontoon.parm` |
| `fetch_parts.py`, `parts/` | Sketchfab part models (glb) and their credits |
| `livery/` | Downloaded logo and flag artwork, with sources |
| `viewer_template.html`, `viewer/NN_*.js` | The 3D page: modules (decals, mounts, electronics, pontoons) run in one scope, in file-name order |
| `build_viewer.py` | Builds the page into `out/ark_viewer.html` (`--out <path>` for another file) |
| `shot.sh` | Build + headless-Edge screenshot of a view (`hero side top under rear inside water floats`, `inflate-<f>`, `landing-<s>`, `livery-check`) |

## Run order
Each step reads what the one before wrote. Run from `hardware/`:
```bash
python industrial-design/obj_to_npz.py         # once, or when the OBJ changes
python industrial-design/ark_from_model.py
python industrial-design/mission_check.py      # ~4 min; if it names a different pack, set industrial_design.pack in ark.json
python industrial-design/pontoon_system.py
python industrial-design/ark_from_model.py     # again: picks up the pontoon kit mass
python electronics/spice/run_spice.py          # power chain for this airframe's mass and pack
python industrial-design/harness.py            # wire gauges against the new currents
python industrial-design/build_viewer.py
```

## Current design (ark.json -> industrial_design)
- 16.19 kg all-up with a 2 kg payload; 12S7P pack (84 x Samsung 50S, 1.51 kWh) in the belly well; mission margin 8 %
  over need + 20 % reserve; thrust-to-weight 2.6.
- Pontoons: 2 x 16.8 L inflatable tubes (1.0 m x 150 mm, lengthened after the SITL wave runs), 107 % buoyancy
  reserve, 73 mm draft; fired at 7.0 m above the water
  (`../flight/scripts/pontoon_trigger.lua`).
- Electronics: 51 parts, 75 wires (`harness.json`), Holybro PM08D power module and AMASS AS150U arming plug for the
  ~108 A peak.

## Limits
Part sizes or masses marked `estimated` in `harness.json` and `pontoon_system.json` are not published by the maker.
Inflation timing is a model until bench-tested (`../flight/README.md`). The drag coefficient (0.9) is a bluff-body
estimate.

---
name: drone-design
description: >
  Design a drone (multirotor, amphibious, cargo, VTOL) to a buildable level of detail without
  building it: requirements, sizing, SPICE power chain, an industrial-design airframe from a real
  mesh, a 1:1 wiring harness of catalogue parts, deployable subsystems with flight-controller
  triggers, a mission check on the real drag, and a 3D web viewer. Use for "design a drone",
  "size the drone", "make the electronics real", "add pontoons / a payload / a subsystem",
  "show the drone", or any work in hardware/. Reference implementation: Ark-1 in hardware/.
---

# Drone design

Ark-1 (`hardware/`) is the worked example of everything below. Read its READMEs before you
change it, and copy its patterns when you start a new drone. The design inspiration is
`../slipstream` (Gannet SX-01).

## The bar
- **It must look real.** Primitive CAD (boxes, cylinders) gets rejected as "childish". Start
  from a real airframe mesh, either the team's model or a sculpted one. Edit that mesh; don't
  invent a new one. Match Gannet SX-01 render quality.
- **Every part is a catalogue part.** Use a real maker and part number with datasheet size,
  mass and ratings. A value the maker doesn't publish is marked `estimated`, and the page
  says "est.".
- **Every wire exists.** Each wire has a gauge, colour, connector at both ends, a route and a
  length. The connection goes to the real port name on the flight controller (TELEM1, GPS1,
  AUX3, CAN2).
- **Nothing just appears.** A deployable part (pontoons, legs, a cargo hook) needs:
  - a mechanism: gas, actuator or latch, with sized parts
  - a trigger: params plus a flight-controller script
  - confirmation that it worked: a sensor
  - a failure case
  - an animation that follows the computed timing
- **Artwork is downloaded, never redrawn.** Logos and flags come from official sources, with
  the URL recorded in `SOURCES.md`. Decals are built from the shell's own triangles so they
  sit flush, with no bleed or flicker.
- **Use the space inside.** Batteries and electronics go inside the shell, and you close any
  opening you leave behind.
- Hardware here is design and simulation only, so leave out licensing, certification and
  build-cost talk.

## Pipeline (each step reads what the one before wrote)
`ark.json` is the single source of truth. Each script writes its results back into it, and
nothing downstream hard-codes a number.

| Step | Ark-1 file | Output |
|---|---|---|
| 1. Requirements | `ark.json` → `requirements` | payload, range out and back, reserve, environment |
| 2. Sizing | `sizing/size_ark.py` | Momentum theory with figure of merit, plus Glauert forward flight. Sweeps real motor, prop and cell candidates (`candidates`). Writes `chosen`. |
| 3. Airframe | `industrial-design/obj_to_npz.py`, `ark_from_model.py` | Scales the mesh to the arm radius, removes parts the mission doesn't need, fits the pack, builds the mass budget from real parts, sizes the floats for the buoyancy reserve |
| 4. Mission on real drag | `mission_check.py` | Rasterised frontal area times Cd. Finds the smallest pack that closes the mission. Takes about 4 min. |
| 5. Subsystems | `pontoon_system.py` → `pontoon_system.json`, `../flight/*.parm`, `../flight/scripts/*.lua` | Gas, timing, firing height, retry and one-side failure |
| 6. Re-close mass | `ark_from_model.py` again | Picks up the subsystem kit mass |
| 7. Power chain | `electronics/spice/run_spice.py` | ngspice battery bus plus BLDC ESC at hover and peak, at the airframe's mass and pack |
| 8. Harness | `harness.json` + `harness.py` | Checks connections, voltage domains, wire and connector ratings against the SPICE currents, and that every part and route stays inside the shell |
| 9. Viewer | `build_viewer.py`, `viewer_template.html`, `viewer/NN_*.js` | One self-contained HTML page |

**Loop until converged.** Mass drives power, power drives the pack, and the pack drives mass.
A change at any step means re-running every step after it. Then check that nothing has gone
out of range:
- connectors and the power module against the new peak current
- Lua defaults against the params
- float size against the new mass

The first Ark-1 change took the drone from 12S4P to 12S7P and from about 11 to 16.2 kg. That
forced a swap from the XT90 to the AS150U and from the PM02D to the PM08D.

## Viewer rules
- **Stack:** three.js r128 from jsDelivr with OrbitControls, RoomEnvironment, DecalGeometry
  and GLTFLoader. Convert colours with `convertSRGBToLinear`, and don't use `sheen`, which
  breaks r128.
- **Data:** everything is embedded as one JSON blob: meshes quantised to uint16, glb part
  models, the harness, the subsystem JSON, livery PNGs and the mission result.
- **Modules:** `viewer/NN_*.js` files are inlined into one function scope in file-name order.
  They share state through `hooks.frame`, `hooks.setInflate` and `clock`. Give each concern
  its own module (decals, mounts, electronics, subsystems) so parallel agents don't collide.
- **Views:** Hero, Side, Top, Under, Rear, a cutaway with a clipping plane, each deploy state,
  and a full sequence (for example a water landing).
- **Tables:** the parts and "Every wire" tables are generated from `harness.json`. Never
  hand-write them.
- **Layout:** at phone width, set `min-width:0` on grid children so there's no horizontal
  scroll.
- **Screenshot checks:** `industrial-design/shot.sh <view>` takes headless-Edge screenshots.
  Edge has a 492 px minimum width. Look at every view and check the console for errors before
  calling it done.
- **Publishing:** publish or update the page with the Artifact tool at the same file path, so
  the link stays the same.

## Parts sourcing
- Sketchfab: run `fetch_parts.py` with `SKETCHFAB_API_TOKEN` from the git-ignored `.env`.
  Never print or commit the token. Few accurate avionics models exist there, so model the
  rest from datasheet dimensions and say so in `parts/SOURCES.md`.
- Check current ratings from the maker's page first. Retailer and forum ratings are flagged
  as such.

## Verify before claiming done
Run from `hardware/`: `ruff check . && ruff format --check . && pytest`.
- Lua scripts are tested with `lupa`.
- Rebuild the viewer, then take screenshots.
- Tests compare stored results against the current sizing, so a stale result fails. Re-run
  the pipeline; don't edit the test.

## Working style for long runs
- Split the work into file-disjoint pieces and fan them out to parallel agents (see the
  `parallel-sonnet` skill). For example: electronics, subsystems and decals each get their own
  JSON, Python and viewer module. Send interface facts between agents, such as pin plans and
  mount points.
- Mark limits with `shortcut: <limit>, <when to upgrade>`.
- End with a report covering:
  - what changed, with numbers: AUW, pack, margin, thrust-to-weight, reserve
  - which parts were swapped and why
  - what is still an estimate
  - the page link

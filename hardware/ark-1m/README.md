# Ark-1M: defence logistics

Ark-1M is the unarmed forward-resupply variant of Ark-1. It flies 4 kg of medical kit, blood, batteries or radios
17 km out to an outpost and back. It uses Ark-1's airframe, motors, pack and electronics, plus three changes:
- a low-signature skin
- an aramid spall liner around the pack and the flight electronics
- self-sealing pontoons

It is design and simulation only, like Ark-1. It carries no weapons or weapon mounts.

`ark.json` here is Ark-1M's source of truth. The same pipeline writes its results, run with `ARK_VARIANT=ark-1m`
(see `../variant.py`).

## Numbers (from `ark.json`)
| | Ark-1M | Ark-1 |
|---|---|---|
| Mission | 17 km out with 4 kg, 17 km back | 20 km out with 2 kg, 20 km back |
| All-up mass | 19.21 kg | 16.19 kg |
| Pack | 12S7P, 1.51 kWh (same) | 12S7P |
| Energy margin over need + 20 % reserve | 6.6 % | 7.8 % |
| Thrust-to-weight | 2.18 (about 2.08 with the 130 A current cap) | 2.59 |
| Hover, per rotor (SPICE) | 2608 rpm, 432 W shaft; ESC duty 0.67 on a 20 % pack, efficiency 0.86 | 2392 rpm, 333 W |
| Lowest cell under peak (20 % pack) | 2.93 V (limit 2.8) | 3.04 V |
| Pontoons | 2 x 17.9 L, 86 % buoyancy reserve, 82 mm draft; fire at 8.0 m | 2 x 16.8 L, 107 %; fire at 7.0 m |

Mass: pack 6.67, payload 4.0, electrical parts 3.26, structure 2.43, pontoon kit 1.68, armour 0.38, mounting 0.25,
props 0.24, copper 0.21 and coating 0.10 kg.

## What changed, and why
- **Payload pod.** A 300 x 200 x 120 mm insulated pod replaces the 250 x 160 x 100 mm one. Its drag is in the
  mission check.
- **Low-signature skin.** The topcoat is MIL-DTL-53039 Type II CARC in Green 383 (FED-STD-595 34094), over
  MIL-DTL-53022 epoxy primer, instead of white gloss: 0.12 kg/m² (est.). The markings are low-visibility, and the
  airframe carries no flag or partner logos. The faceted shell panels from the brief are not modelled: the mesh is
  Ark-1's.
- **Armoured core.** Three plies of DuPont Kevlar 29 plain-weave ballistic fabric, laminated into panels, are boxed
  around the pack and a 220 x 160 x 60 mm avionics volume: 0.38 kg. This is a spall and debris liner, not a rated
  protection level, and the areal mass and ply count are estimates.
- **Self-sealing pontoons.** A 0.5 mm natural-rubber inner liner (fuel-cell style) sits inside the 210D TPU tubes.
  It is an estimate, and it makes the kit 0.5 kg heavier.
- **80 % buoyancy reserve** (Ark-1: 100 %). This keeps the standard 60 g lifejacket CO2 cylinder. At 100 % the tubes
  grow to 19 L and need 64 g with the 1.25 gas margin, more than the largest standard cylinder. For a resupply
  drone, a water landing is the emergency case. Tube length, which sets pitch stability in waves, is unchanged.
- **Current cap and wiring.** The uncapped peak is 140 A, which would sit right at the AMASS AS150U arming plug's
  140 A instantaneous rating. ArduCopter `MOT_BAT_CURR_MAX = 130` (`flight/ark1m.parm`) keeps it inside. The main
  pack path (pack, plug, PM08D, PDB) moves from 8 AWG to 6 AWG silicone wire.
- **Range.** Range is set to 17 km so the mission keeps a margin like Ark-1's. At 18 km the margin is 1.7 %.

## Run
From `hardware/`, the same order as Ark-1 (`industrial-design/README.md`), with the variant set:
```bash
export ARK_VARIANT=ark-1m
python industrial-design/ark_from_model.py
python industrial-design/mission_check.py
python industrial-design/pontoon_system.py && python industrial-design/ark_from_model.py   # repeat until the AUW settles
python electronics/spice/run_spice.py
python industrial-design/harness.py
python industrial-design/build_viewer.py      # -> industrial-design/out/ark-1m/ark_viewer.html
```
`industrial-design/tests/test_ark_1m.py` checks the stored results. It fails if a step goes stale.

## Not done
- **SITL.** Ark-1M has not been flown in SITL. The water landing and wave runs are Ark-1's.
- **Gas margin.** The pontoon gas sizing reuses Ark-1's model; the 60 g cylinder now has a 1.25 margin at 17.9 L.
- **Unmodelled features.** No quiet props, no navigation that works with GPS jammed, and no faceted shell. The user
  chose the skin and the armour.

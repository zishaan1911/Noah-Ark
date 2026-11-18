"""Which drone the hardware pipeline works on: Ark-1 by default, or a variant folder named by ARK_VARIANT.

    ARK_VARIANT=ark-1m python industrial-design/ark_from_model.py

A variant keeps its own source of truth and generated files, so Ark-1's stay untouched:
    hardware/<variant>/ark.json                          (requirements, choices, results)
    hardware/<variant>/industrial-design/harness.json    (its harness; pontoon_system.json is written next to it)
    hardware/<variant>/flight/pontoon.parm
    hardware/industrial-design/out/<variant>/            (model cache and viewer page)
The airframe mesh, part models, livery artwork, viewer code and scripts are shared.
"""

import os
from pathlib import Path

HARDWARE = Path(__file__).resolve().parent
NAME = os.environ.get("ARK_VARIANT", "").strip()
if NAME and not (HARDWARE / NAME / "ark.json").is_file():
    raise SystemExit(f"ARK_VARIANT={NAME}: no {HARDWARE / NAME / 'ark.json'}")

ROOT = HARDWARE / NAME if NAME else HARDWARE
ARK_JSON = ROOT / "ark.json"
ID_DATA = ROOT / "industrial-design"  # harness.json, pontoon_system.json
OUT = HARDWARE / "industrial-design" / "out" / NAME if NAME else HARDWARE / "industrial-design" / "out"
FLIGHT = ROOT / "flight"

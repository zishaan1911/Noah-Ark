"""Flight bridge: Ark-1's companion computer, MQTT <-> MAVLink.

Makes the generated contract models (shared/generated/python) importable as `ark_contracts`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_repo_pkg = Path(__file__).resolve().parents[3] / "shared" / "generated" / "python"
for _p in (os.environ.get("ARK_CONTRACTS_PATH"), _repo_pkg):
    if _p and Path(_p).is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

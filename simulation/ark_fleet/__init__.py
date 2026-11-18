"""Ark fleet sim: a cheap kinematic simulation of a whole fleet (24 drones, 6 hubs) for Ark Command.

Makes the dispatch optimiser (backend/functions/dispatch-agent) importable as `optimiser` and `energy`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# shortcut: in the cloud the optimiser is the dispatch-agent Lambda behind Step Functions; locally the sim calls it
# in-process. Upgrade when the sim should exercise the real Step Functions flow.
_repo_pkg = Path(__file__).resolve().parents[2] / "backend" / "functions" / "dispatch-agent"
for _p in (os.environ.get("ARK_DISPATCH_PATH"), _repo_pkg):
    if _p and Path(_p).is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

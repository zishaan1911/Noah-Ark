"""In-memory SOS store: what DynamoDB holds in AWS. Every SOS is schema-checked before it is kept."""

import copy
import json
import os
import secrets
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

HERE = Path(__file__).resolve().parent
SCHEMAS = Path(os.environ.get("ARK_SCHEMAS_DIR", HERE.parents[2] / "shared" / "schemas"))

_docs = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in SCHEMAS.glob("*.schema.json")}
_registry = Registry().with_resources((name, Resource.from_contents(doc)) for name, doc in _docs.items())


def _validator(ref: str) -> Draft202012Validator:
    return Draft202012Validator({"$ref": ref}, registry=_registry, format_checker=FormatChecker())


SOS = _validator("sos-request.schema.json")
REPORT = _validator("sos-request.schema.json#/$defs/report")
TRIAGE = _validator("sos-request.schema.json#/$defs/triage")
LOCATION_UPDATE = _validator("sos-request.schema.json#/$defs/locationUpdate")

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CLOSED = ("delivered", "closed")


def new_id() -> str:
    """`sos_` + 26-char Crockford ULID: 48-bit ms timestamp, 80 random bits."""
    n = (int(time.time() * 1000) << 80) | secrets.randbits(80)
    return "sos_" + "".join(CROCKFORD[(n >> (5 * i)) & 31] for i in range(25, -1, -1))


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class SosStore:
    """Thread-safe. Methods return copies, so callers never mutate stored state."""

    # shortcut: in-memory, lost on restart; DynamoDB in AWS.
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, dict] = {}

    def _keep(self, sos: dict) -> dict:
        errors = list(SOS.iter_errors(sos))
        if errors:
            raise ValueError(errors[0].message)
        self._items[sos["id"]] = copy.deepcopy(sos)
        return copy.deepcopy(sos)

    def create(self, report: dict) -> dict:
        sos = {"id": new_id(), "createdAt": _now(), "status": "new", "report": copy.deepcopy(report)}
        with self._lock:
            return self._keep(sos)

    def get(self, sos_id: str) -> dict | None:
        with self._lock:
            sos = self._items.get(sos_id)
            return copy.deepcopy(sos) if sos else None

    def update(self, sos_id: str, **fields) -> dict | None:
        """Set top-level fields (status, triage, ...) on a stored SOS."""
        with self._lock:
            sos = self._items.get(sos_id)
            if sos is None:
                return None
            return self._keep({**sos, **fields})

    def replace_report(self, sos_id: str, report: dict) -> dict | None:
        return self.update(sos_id, report=copy.deepcopy(report))

    def update_location(self, sos_id: str, update: dict) -> dict | None:
        with self._lock:
            sos = self._items.get(sos_id)
            if sos is None:
                return None
            report = {**sos["report"], "location": copy.deepcopy(update["location"])}
            return self._keep({**sos, "report": report})

    def apply_mission(self, mission: dict) -> list[dict]:
        """Link a mission to the SOS calls it serves; returns the SOS that changed."""
        changed = []
        with self._lock:
            for sos_id in mission.get("sosRequestIds", []):
                sos = self._items.get(sos_id)
                if sos is None or sos["status"] in CLOSED:
                    continue
                delivery = {"droneId": mission["droneId"], "missionStatus": mission["status"]}
                for key in ("etaMinutes", "payload", "payloadKg"):
                    if key in mission:
                        delivery[key] = mission[key]
                status = "delivered" if mission["status"] == "delivered" else "assigned"
                changed.append(self._keep({**sos, "missionId": mission["id"], "delivery": delivery, "status": status}))
        return changed

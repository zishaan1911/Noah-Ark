"""Contract tests: every schema is valid, every example passes or fails as named, every OpenAPI $ref resolves."""

import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
EXAMPLES = ROOT / "examples"

_docs = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in SCHEMAS.glob("*.schema.json")}
REGISTRY = Registry().with_resources((name, Resource.from_contents(doc)) for name, doc in _docs.items())

# examples/<dir> -> the schema (or sub-schema) it is checked against
TARGETS = {
    "sos-request": {"$ref": "sos-request.schema.json"},
    "sos-report": {"$ref": "sos-request.schema.json#/$defs/report"},
    "sos-triage": {"$ref": "sos-request.schema.json#/$defs/triage"},
    "mission": {"$ref": "mission.schema.json"},
    "mission-request": {"$ref": "mission.schema.json#/$defs/request"},
    "telemetry": {"$ref": "telemetry.schema.json"},
    "drone-command": {"$ref": "drone-command.schema.json"},
    "drone-event": {"$ref": "drone-event.schema.json"},
    "drone": {"$ref": "drone.schema.json"},
    "live-update": {"$ref": "live-update.schema.json"},
    "manual-control": {"$ref": "manual-control.schema.json"},
    "weather": {"$ref": "weather.schema.json"},
}


def validator(target: dict) -> Draft202012Validator:
    return Draft202012Validator(target, registry=REGISTRY, format_checker=FormatChecker())


@pytest.mark.parametrize("name", sorted(_docs))
def test_schema_is_valid_2020_12(name: str) -> None:
    Draft202012Validator.check_schema(_docs[name])


def test_every_example_dir_has_a_target() -> None:
    assert {p.name for p in EXAMPLES.iterdir() if p.is_dir()} == set(TARGETS)


EXAMPLE_FILES = sorted(EXAMPLES.glob("*/*.json"))


@pytest.mark.parametrize("path", EXAMPLE_FILES, ids=lambda p: f"{p.parent.name}/{p.stem}")
def test_example(path: Path) -> None:
    errors = list(validator(TARGETS[path.parent.name]).iter_errors(json.loads(path.read_text(encoding="utf-8"))))
    if path.stem.startswith("valid-"):
        assert not errors, [e.message for e in errors]
    else:
        assert path.stem.startswith("invalid-")
        assert errors, "expected this example to be rejected"


def test_mission_payload_kg_matches_ark1_design() -> None:
    ark = json.loads((ROOT.parent / "hardware" / "ark.json").read_text(encoding="utf-8"))
    assert _docs["mission.schema.json"]["properties"]["payloadKg"]["maximum"] == ark["requirements"]["payload_kg"]


PYDANTIC = {
    "sos-request": "SosRequest",
    "sos-report": "SosReport",
    "sos-triage": "SosTriage",
    "mission": "Mission",
    "mission-request": "MissionRequest",
    "telemetry": "Telemetry",
    "drone-command": "DroneCommand",
    "drone-event": "DroneEvent",
    "drone": "Drone",
}


@pytest.mark.parametrize(
    "path", [p for p in EXAMPLE_FILES if p.stem.startswith("valid-") and p.parent.name in PYDANTIC], ids=str
)
def test_generated_pydantic_parses_valid_examples(path: Path) -> None:
    """Catches generated/ drifting from the schemas (re-run scripts/codegen.py)."""
    import sys

    sys.path.insert(0, str(ROOT / "generated" / "python"))
    import ark_contracts

    model = getattr(ark_contracts, PYDANTIC[path.parent.name])
    model.model_validate_json(path.read_text(encoding="utf-8"))


def _refs(node):
    if isinstance(node, dict):
        if isinstance(node.get("$ref"), str):
            yield node["$ref"]
        for v in node.values():
            yield from _refs(v)
    elif isinstance(node, list):
        for v in node:
            yield from _refs(v)


def test_openapi_refs_resolve() -> None:
    api = yaml.safe_load((ROOT / "api" / "openapi.yaml").read_text(encoding="utf-8"))
    refs = set(_refs(api))
    assert refs
    for ref in refs:
        file, _, pointer = ref.partition("#")
        doc = api if not file else _docs[Path(file).name]
        for part in filter(None, pointer.split("/")):
            doc = doc[part]  # KeyError = broken ref

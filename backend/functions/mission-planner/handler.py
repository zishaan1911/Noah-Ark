"""mission-planner Lambda: the supply kit for one SOS.

Input (from the sos-flow state machine): a SosRequest. Output: {payload, payloadKg, aiRationale}, the kit fields of a
Mission. Drone choice and the route are not here yet.
"""

import json
import os

import boto3
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from kit import SCHEMAS, plan_kit

_docs = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in SCHEMAS.glob("*.schema.json")}
_registry = Registry().with_resources((name, Resource.from_contents(doc)) for name, doc in _docs.items())
SOS = Draft202012Validator({"$ref": "sos-request.schema.json"}, registry=_registry, format_checker=FormatChecker())
PAYLOAD_ITEM = Draft202012Validator({"$ref": "mission.schema.json#/$defs/payloadItem"}, registry=_registry)

_client = None


def bedrock():
    """Created on first use so tests and cold starts without Bedrock calls don't need AWS."""
    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=os.environ["AWS_REGION"])
    return _client


def handler(event: dict, context=None, client=None) -> dict:
    SOS.validate(event)
    kit = plan_kit(event, client or bedrock(), os.environ["BEDROCK_MODEL_ID"])
    for line in kit["payload"]:
        PAYLOAD_ITEM.validate(line)
    return kit

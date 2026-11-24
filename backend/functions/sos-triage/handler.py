"""sos-triage Lambda: urgency and needs for one SOS.

Input (from the sos-flow state machine): a SosRequest. Output: a SosTriage. Bedrock does the triage; if it is not
configured or fails, keyword rules answer instead so a call is never left untriaged.
"""

import json
import logging
import os
import re
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

from rules import triage_by_rules

HERE = Path(__file__).resolve().parent
# shortcut: reads the schemas from the repo, bundle shared/schemas into the Lambda asset when infra/ packages it
SCHEMAS = Path(os.environ.get("ARK_SCHEMAS_DIR", HERE.parents[2] / "shared" / "schemas"))
PROMPT = HERE / "prompts" / "triage.v1.md"

_docs = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in SCHEMAS.glob("*.schema.json")}
_registry = Registry().with_resources((name, Resource.from_contents(doc)) for name, doc in _docs.items())
SOS = Draft202012Validator({"$ref": "sos-request.schema.json"}, registry=_registry, format_checker=FormatChecker())
TRIAGE = Draft202012Validator({"$ref": "sos-request.schema.json#/$defs/triage"}, registry=_registry)

_client = None


def bedrock():
    """Created on first use so tests and cold starts without Bedrock calls don't need AWS."""
    import boto3

    global _client
    if _client is None:
        _client = boto3.client("bedrock-runtime", region_name=os.environ["AWS_REGION"])
    return _client


def _first_json_object(text: str) -> dict:
    """The first JSON object in the reply; models sometimes add a code fence or a sentence around it."""
    start = text.index("{")
    obj, _ = json.JSONDecoder().raw_decode(re.sub(r"```(?:json)?", "", text[start:]))
    if not isinstance(obj, dict):
        raise TypeError("reply is not a JSON object")
    return obj


def ask_bedrock(report: dict, client, model_id: str) -> dict:
    """One Converse call. Returns the triage; raises on anything unparseable or off-schema."""
    prompt = PROMPT.read_text(encoding="utf-8")
    body = f"{prompt}\n\nSOS report:\n{json.dumps(report, ensure_ascii=False)}"
    resp = client.converse(modelId=model_id, messages=[{"role": "user", "content": [{"text": body}]}])
    text = "".join(part.get("text", "") for part in resp["output"]["message"]["content"])
    result = _first_json_object(text)
    TRIAGE.validate(result)
    return result


def triage(report: dict, client=None) -> tuple[dict, str]:
    """(SosTriage, "bedrock" | "rules"). Falls back to rules on any Bedrock failure."""
    model_id, region = os.environ.get("BEDROCK_MODEL_ID"), os.environ.get("AWS_REGION")
    if model_id and region:
        try:
            return ask_bedrock(report, client or bedrock(), model_id), "bedrock"
        except Exception:  # any Bedrock or parse failure falls back to the rules
            logging.getLogger(__name__).warning("Bedrock triage failed; using the rules", exc_info=True)
    return triage_by_rules(report), "rules"


def handler(event: dict, context=None, client=None) -> dict:
    SOS.validate(event)
    return triage(event["report"], client)[0]

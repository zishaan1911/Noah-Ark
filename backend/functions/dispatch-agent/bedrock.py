"""Optional Bedrock rewrite of the dispatch rationale."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict
from pathlib import Path

from optimiser import Choice, Order

log = logging.getLogger(__name__)

PROMPT_FILE = Path(__file__).parent / "prompts" / "dispatch-rationale.v1.md"
MAX_CHARS = 2000  # mission.aiRationale maxLength


def explain_with_bedrock(choice: Choice, order: Order) -> str:
    """Operator-facing explanation. Falls back to the template rationale if Bedrock is unset or fails."""
    model_id = os.environ.get("BEDROCK_MODEL_ID")
    if not model_id:
        return choice.rationale
    try:
        import boto3  # lazy: only needed when Bedrock is configured

        client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "ap-southeast-1"))
        payload = json.dumps({"order": asdict(order), "choice": asdict(choice)})
        resp = client.converse(
            modelId=model_id,
            system=[{"text": PROMPT_FILE.read_text(encoding="utf-8")}],
            messages=[{"role": "user", "content": [{"text": payload}]}],
        )
        for block in resp["output"]["message"]["content"]:
            if "text" in block:
                return block["text"].strip()[:MAX_CHARS]
        return choice.rationale
    except Exception as exc:  # noqa: BLE001 - any failure must fall back to the template
        log.warning("Bedrock explanation failed, using template: %s", exc)
        return choice.rationale

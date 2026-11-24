"""Supply kit for one SOS: Bedrock proposes candidate items, a knapsack packs them under the drone's payload cap.

The model ranks and weighs items; it never does the arithmetic. Packing is plain code, so the kit can't go over the cap.
"""

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
# shortcut: reads the schemas from the repo, bundle shared/schemas into the Lambda asset when infra/ packages it
SCHEMAS = Path(os.environ.get("ARK_SCHEMAS_DIR", HERE.parents[2] / "shared" / "schemas"))
PROMPT = HERE / "prompts" / "kit.v1.md"

MAX_CANDIDATES = 20
MAX_QTY = 20
# Value of one unit by priority. Each extra unit of the same item is worth less (value / n), so the kit spreads out.
PRIORITY_VALUE = {5: 1000, 4: 400, 3: 150, 2: 50, 1: 15}

# Used when Bedrock fails or proposes nothing usable, so the operator still gets a plan to approve.
FALLBACK = [
    {"item": "Drinking water 500 ml", "unitWeightKg": 0.52, "maxQty": 4, "priority": 5},
    {"item": "Oral rehydration salts sachet", "unitWeightKg": 0.03, "maxQty": 4, "priority": 4},
    {"item": "First-aid kit", "unitWeightKg": 0.25, "maxQty": 1, "priority": 4},
    {"item": "Energy biscuits 100 g", "unitWeightKg": 0.11, "maxQty": 4, "priority": 3},
]


def payload_cap_kg() -> float:
    """The mission schema's payloadKg maximum (Ark-1's 2 kg, kept equal to hardware/ark.json by shared/ tests)."""
    mission = json.loads((SCHEMAS / "mission.schema.json").read_text(encoding="utf-8"))
    return mission["properties"]["payloadKg"]["maximum"]


@dataclass(frozen=True)
class Candidate:
    item: str
    unit_g: int
    max_qty: int
    priority: int


def parse_candidates(raw: list, cap_kg: float) -> list[Candidate]:
    """Keep only well-formed candidates; a bad line from the model is dropped, not trusted."""
    out = []
    for c in raw[:MAX_CANDIDATES]:
        if not isinstance(c, dict):
            continue
        item, weight, qty, priority = c.get("item"), c.get("unitWeightKg"), c.get("maxQty"), c.get("priority")
        if not (isinstance(item, str) and item.strip() and len(item) <= 100):
            continue
        if isinstance(weight, bool) or not isinstance(weight, int | float) or not 0 < weight <= cap_kg:
            continue
        if isinstance(qty, bool) or not isinstance(qty, int) or qty < 1:
            continue
        if priority not in PRIORITY_VALUE or isinstance(priority, bool):
            continue
        out.append(Candidate(item.strip(), max(1, round(weight * 1000)), min(qty, MAX_QTY), priority))
    return out


def pack(candidates: list[Candidate], cap_kg: float) -> list[dict]:
    """Bounded knapsack in grams. Returns PayloadItem dicts; weightKg is the line total (qty included)."""
    cap_g = round(cap_kg * 1000)
    units = [
        (i, c.unit_g, PRIORITY_VALUE[c.priority] * 1000 // n)
        for i, c in enumerate(candidates)
        for n in range(1, c.max_qty + 1)
    ]
    # best[w] = (value, chosen unit indexes) using at most w grams; 0/1 over units, iterating weight downwards.
    best: list[tuple[int, tuple[int, ...]]] = [(0, ())] * (cap_g + 1)
    for u, (_, grams, value) in enumerate(units):
        for w in range(cap_g, grams - 1, -1):
            v = best[w - grams][0] + value
            if v > best[w][0]:
                best[w] = (v, best[w - grams][1] + (u,))
    qty: dict[int, int] = {}
    for u in best[cap_g][1]:
        qty[units[u][0]] = qty.get(units[u][0], 0) + 1
    return [
        {"item": candidates[i].item, "qty": n, "weightKg": candidates[i].unit_g * n / 1000}
        for i, n in sorted(qty.items(), key=lambda kv: (-candidates[kv[0]].priority, kv[0]))
    ]


def ask_bedrock(sos: dict, client, model_id: str, cap_kg: float) -> tuple[list, str]:
    """One Converse call. Returns (raw candidates, rationale); raises on anything unparseable."""
    system = PROMPT.read_text(encoding="utf-8").replace("{cap_kg}", f"{cap_kg:g}")
    sender = {k: sos[k] for k in ("report", "triage") if k in sos}
    resp = client.converse(
        modelId=model_id,
        system=[{"text": system}],
        messages=[{"role": "user", "content": [{"text": json.dumps(sender, ensure_ascii=False)}]}],
        inferenceConfig={"temperature": 0.2, "maxTokens": 2000},
    )
    text = "".join(part.get("text", "") for part in resp["output"]["message"]["content"])
    # Models sometimes wrap JSON in a code fence despite the prompt.
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text)
    answer = json.loads(text)
    return answer["candidates"], str(answer.get("rationale", ""))[:1000]


def plan_kit(sos: dict, client, model_id: str) -> dict:
    """{payload, payloadKg, aiRationale} for one SOS request. Never exceeds the cap, never returns an empty kit."""
    cap_kg = payload_cap_kg()
    try:
        raw, rationale = ask_bedrock(sos, client, model_id, cap_kg)
        payload = pack(parse_candidates(raw, cap_kg), cap_kg)
    except Exception as e:  # noqa: BLE001 - any Bedrock or parse failure falls back to the standard kit
        payload, rationale = [], f"Bedrock kit planning failed ({type(e).__name__})."
    if not payload:
        payload = pack(parse_candidates(FALLBACK, cap_kg), cap_kg)
        rationale = (rationale + " Standard relief kit used; check it before approving.").strip()
    grams = sum(round(line["weightKg"] * 1000) for line in payload)
    return {"payload": payload, "payloadKg": grams / 1000, "aiRationale": rationale}

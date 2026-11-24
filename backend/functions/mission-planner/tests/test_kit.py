import json
from pathlib import Path

import pytest
from jsonschema import ValidationError

import handler
from kit import Candidate, pack, parse_candidates, payload_cap_kg

EXAMPLES = Path(__file__).resolve().parents[4] / "shared" / "examples"
SOS = json.loads((EXAMPLES / "sos-request" / "valid-triaged.json").read_text(encoding="utf-8"))


class FakeBedrock:
    """Stands in for the bedrock-runtime client: records the call, answers with fixed text or raises."""

    def __init__(self, answer):
        self.answer = answer
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.answer, Exception):
            raise self.answer
        return {"output": {"message": {"role": "assistant", "content": [{"text": self.answer}]}}}


def answer(candidates, rationale="Insulin first."):
    return json.dumps({"candidates": candidates, "rationale": rationale})


WATER = {"item": "Drinking water 500 ml", "unitWeightKg": 0.52, "maxQty": 6, "priority": 5}
INSULIN = {"item": "Insulin cold pack", "unitWeightKg": 0.4, "maxQty": 1, "priority": 5}
BISCUITS = {"item": "Energy biscuits 100 g", "unitWeightKg": 0.11, "maxQty": 8, "priority": 3}
RADIO = {"item": "Wind-up radio", "unitWeightKg": 0.9, "maxQty": 1, "priority": 1}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")


def grams(kit):
    return sum(round(line["weightKg"] * 1000) for line in kit["payload"])


def test_cap_is_the_ark1_payload():
    assert payload_cap_kg() == 2.0


def test_pack_never_exceeds_the_cap_and_keeps_the_must_haves():
    cands = parse_candidates([WATER, INSULIN, BISCUITS, RADIO], 2.0)
    kit = pack(cands, 2.0)
    total = sum(round(line["weightKg"] * 1000) for line in kit)
    assert total <= 2000
    names = [line["item"] for line in kit]
    assert names[:2] == ["Drinking water 500 ml", "Insulin cold pack"]  # priority 5 first
    assert "Wind-up radio" not in names  # 0.9 kg of priority 1 loses to water and food


def test_pack_spreads_across_items_instead_of_only_the_top_one():
    kit = pack([Candidate("Water", 520, 6, 5), Candidate("ORS", 30, 4, 4)], 2.0)
    assert {line["item"]: line["qty"] for line in kit} == {"Water": 3, "ORS": 4}


def test_bad_candidates_from_the_model_are_dropped():
    raw = [
        WATER,
        {"item": "", "unitWeightKg": 0.1, "maxQty": 1, "priority": 3},
        {"item": "Generator", "unitWeightKg": 30, "maxQty": 1, "priority": 5},
        {"item": "Rope", "unitWeightKg": "heavy", "maxQty": 1, "priority": 2},
        {"item": "Torch", "unitWeightKg": 0.2, "maxQty": 1, "priority": 9},
        {"item": "Tent", "unitWeightKg": 1.5, "maxQty": True, "priority": 2},
        "not an object",
    ]
    assert [c.item for c in parse_candidates(raw, 2.0)] == ["Drinking water 500 ml"]


def test_handler_plans_a_valid_kit_from_bedrock():
    fake = FakeBedrock("```json\n" + answer([WATER, INSULIN, BISCUITS]) + "\n```")
    kit = handler.handler(SOS, client=fake)
    assert grams(kit) == round(kit["payloadKg"] * 1000) <= 2000
    assert kit["aiRationale"] == "Insulin first."
    assert any(line["item"] == "Insulin cold pack" for line in kit["payload"])
    call = fake.calls[0]
    assert call["modelId"] == "test-model"
    assert "2 kg" in call["system"][0]["text"]
    assert json.loads(call["messages"][0]["content"][0]["text"])["report"]["peopleCount"] == 4


@pytest.mark.parametrize("reply", [RuntimeError("throttled"), "not json", answer([]), answer([{"item": "x"}])])
def test_handler_falls_back_to_the_standard_kit(reply):
    kit = handler.handler(SOS, client=FakeBedrock(reply))
    assert kit["payload"] and grams(kit) <= 2000
    assert "Standard relief kit" in kit["aiRationale"]


def test_handler_rejects_a_malformed_sos():
    with pytest.raises(ValidationError):
        handler.handler({"id": "nope"}, client=FakeBedrock(answer([WATER])))

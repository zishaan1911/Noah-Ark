import json

import pytest

from handler import TRIAGE, handler, triage

MALAY = {
    "channel": "app",
    "location": {"lat": 6.4, "lon": 116.4},
    "language": "ms",
    "rawMessage": "Tolong! Air naik sampai bumbung. Kami 5 orang, ada bayi 6 bulan dan nenek kencing manis, insulin dah habis.",
    "peopleCount": 5,
}
ENGLISH = {
    "channel": "sms",
    "location": {"lat": 6.4, "lon": 116.4},
    "rawMessage": "we need food and water",
    "peopleCount": 2,
}
GOOD = {"urgency": 4, "needs": ["water"], "summary": "Needs water.", "waterLanding": False}


class FakeClient:
    def __init__(self, text: str):
        self.text = text
        self.calls = []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {"output": {"message": {"content": [{"text": self.text}]}}}


@pytest.fixture(autouse=True)
def no_env(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)


@pytest.fixture
def bedrock_env(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")
    monkeypatch.setenv("AWS_REGION", "ap-southeast-1")


def test_malay_flood_is_life_threatening():
    result, path = triage(MALAY)
    assert path == "rules"
    assert result["urgency"] == 5
    assert result["waterLanding"] is True
    assert "medicine" in result["needs"]
    assert result["peopleCount"] == 5
    TRIAGE.validate(result)


def test_english_food_and_water():
    result, _ = triage(ENGLISH)
    assert result["urgency"] == 3
    assert result["waterLanding"] is False
    assert {"food", "water"} <= set(result["needs"])
    TRIAGE.validate(result)


def test_bedrock_reply_is_used(bedrock_env):
    client = FakeClient("Here you go:\n```json\n" + json.dumps(GOOD) + "\n```")
    result, path = triage(MALAY, client)
    assert path == "bedrock"
    assert result == GOOD
    assert client.calls[0]["modelId"] == "test-model"


def test_garbage_falls_back_to_rules(bedrock_env):
    result, path = triage(MALAY, FakeClient("sorry, I cannot help"))
    assert path == "rules"
    assert result["urgency"] == 5


def test_off_schema_falls_back_to_rules(bedrock_env):
    _result, path = triage(MALAY, FakeClient(json.dumps({"urgency": 9, "needs": [], "summary": "x"})))
    assert path == "rules"


def test_handler_returns_the_triage_dict():
    sos = {"id": "sos_" + "0" * 26, "createdAt": "2026-11-20T10:00:00Z", "status": "new", "report": MALAY}
    result = handler(sos)
    assert result["urgency"] == 5

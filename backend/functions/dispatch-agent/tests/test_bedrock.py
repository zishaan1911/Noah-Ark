import sys
import types

from bedrock import explain_with_bedrock
from energy import Trip
from optimiser import Choice, Order

ORDER = Order("ord_1", "relief", 5.9, 116.1, 1.0, 4, 0.0)
CHOICE = Choice("ord_1", "ARK-104", 6.0, Trip(5.0, 5.0, 6.0, 13.0, 30.0), 60.0, None, "template")


def fake_boto3(monkeypatch, converse):
    client = types.SimpleNamespace(converse=converse)
    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=lambda *a, **k: client))
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")


def test_uses_bedrock_text(monkeypatch):
    fake_boto3(monkeypatch, lambda **k: {"output": {"message": {"content": [{"text": "  ARK-104 is closest.  "}]}}})
    assert explain_with_bedrock(CHOICE, ORDER) == "ARK-104 is closest."


def test_falls_back_to_template_on_error(monkeypatch):
    def boom(**k):
        raise RuntimeError("throttled")

    fake_boto3(monkeypatch, boom)
    assert explain_with_bedrock(CHOICE, ORDER) == "template"

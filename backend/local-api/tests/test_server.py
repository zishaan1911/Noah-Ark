import json
import threading
import urllib.error
import urllib.request

import pytest

from local_api.mqtt_link import apply_live_message
from local_api.server import make_server
from local_api.store import SosStore

MALAY = {
    "channel": "app",
    "location": {"lat": 6.4, "lon": 116.4},
    "language": "ms",
    "rawMessage": "Tolong! Air naik sampai bumbung. Kami 5 orang, ada bayi 6 bulan dan nenek kencing manis, insulin dah habis.",
    "peopleCount": 5,
}
LOCATION = {"location": {"lat": 6.41, "lon": 116.41}, "ts": "2026-11-20T10:00:00Z"}


class FakePublisher:
    def __init__(self):
        self.sent = []

    def publish(self, sos: dict) -> None:
        self.sent.append(sos)


@pytest.fixture(autouse=True)
def no_bedrock(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    monkeypatch.delenv("AWS_REGION", raising=False)


@pytest.fixture
def api():
    store, pub = SosStore(), FakePublisher()
    server = make_server(store, pub, 0, "127.0.0.1")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/v1", store, pub
    server.shutdown()
    server.server_close()


def call(url: str, method: str = "GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None), r.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None), e.headers


def test_create_triages_and_publishes(api):
    base, _, pub = api
    code, sos, _ = call(f"{base}/sos", "POST", MALAY)
    assert code == 201
    assert sos["status"] == "triaged"
    assert sos["triage"]["urgency"] == 5
    assert sos["triage"]["waterLanding"] is True
    assert len(pub.sent) == 1 and pub.sent[0]["id"] == sos["id"]
    assert call(f"{base}/sos/{sos['id']}")[:2] == (200, sos)


def test_health_and_unknown(api):
    base, _, _ = api
    assert call(f"{base}/health")[:2] == (200, {"ok": True})
    assert call(f"{base}/sos/sos_{'0' * 26}")[0] == 404
    assert call(f"{base}/nope")[0] == 404


def test_put_report_retriages(api):
    base, _, pub = api
    _, sos, _ = call(f"{base}/sos", "POST", {**MALAY, "rawMessage": "need food", "peopleCount": 2})
    assert sos["triage"]["urgency"] == 3
    code, updated, _ = call(f"{base}/sos/{sos['id']}/report", "PUT", MALAY)
    assert code == 200 and updated["triage"]["urgency"] == 5
    assert len(pub.sent) == 2


def test_location_then_delivered_is_409(api):
    base, store, _pub = api
    _, sos, _ = call(f"{base}/sos", "POST", MALAY)
    assert call(f"{base}/sos/{sos['id']}/location", "POST", LOCATION)[0] == 204
    assert store.get(sos["id"])["report"]["location"]["lat"] == 6.41
    mission = {"id": "msn_" + "0" * 26, "droneId": "ARK-006", "status": "delivered", "sosRequestIds": [sos["id"]]}
    changed = apply_live_message(store, json.dumps({"kind": "mission", "data": mission}))
    assert changed[0]["status"] == "delivered"
    assert call(f"{base}/sos/{sos['id']}/location", "POST", LOCATION)[0] == 409
    assert call(f"{base}/sos/{sos['id']}/report", "PUT", MALAY)[0] == 409


def test_invalid_body_is_400(api):
    base, _, pub = api
    code, body, _ = call(f"{base}/sos", "POST", {"channel": "pigeon"})
    assert code == 400 and "message" in body
    assert pub.sent == []


def test_options_has_cors(api):
    base, _, _ = api
    code, _, headers = call(f"{base}/sos", "OPTIONS")
    assert code == 204
    assert headers["Access-Control-Allow-Origin"] == "*"
    assert "PUT" in headers["Access-Control-Allow-Methods"]
    assert headers["Access-Control-Allow-Headers"] == "Content-Type"

import pytest

from local_api.store import SosStore

REPORT = {"channel": "app", "location": {"lat": 6.4, "lon": 116.4}, "rawMessage": "help", "peopleCount": 3}


def mission(sos_ids, status="dispatched"):
    return {
        "id": "msn_" + "0" * 26,
        "droneId": "ARK-006",
        "status": status,
        "sosRequestIds": sos_ids,
        "etaMinutes": 12.5,
        "payload": [{"item": "Drinking water 500 ml", "qty": 2, "weightKg": 1.04}],
        "payloadKg": 1.04,
    }


def test_create_sets_id_and_validates():
    store = SosStore()
    sos = store.create(REPORT)
    assert sos["id"].startswith("sos_") and len(sos["id"]) == 30
    assert sos["status"] == "new" and sos["createdAt"].endswith("Z")
    assert store.get(sos["id"]) == sos
    assert store.create(REPORT)["id"] != sos["id"]


def test_invalid_report_is_refused():
    with pytest.raises(ValueError):
        SosStore().create({"channel": "pigeon", "location": {"lat": 0, "lon": 0}})


def test_apply_mission_assigns_then_delivers():
    store = SosStore()
    sos = store.create(REPORT)
    [assigned] = store.apply_mission(mission([sos["id"]]))
    assert assigned["status"] == "assigned"
    assert assigned["missionId"] == "msn_" + "0" * 26
    assert assigned["delivery"]["droneId"] == "ARK-006"
    assert assigned["delivery"]["missionStatus"] == "dispatched"
    assert assigned["delivery"]["etaMinutes"] == 12.5
    [delivered] = store.apply_mission(mission([sos["id"]], "delivered"))
    assert delivered["status"] == "delivered"
    assert store.get(sos["id"])["status"] == "delivered"


def test_unknown_ids_are_ignored():
    store = SosStore()
    assert store.apply_mission(mission(["sos_" + "1" * 26])) == []


def test_update_location_and_replace_report():
    store = SosStore()
    sos = store.create(REPORT)
    moved = store.update_location(sos["id"], {"location": {"lat": 6.5, "lon": 116.5}, "ts": "2026-11-20T10:00:00Z"})
    assert moved["report"]["location"]["lat"] == 6.5
    assert store.replace_report(sos["id"], {**REPORT, "peopleCount": 4})["report"]["peopleCount"] == 4
    assert store.update_location("sos_" + "2" * 26, {"location": {"lat": 0, "lon": 0}}) is None

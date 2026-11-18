from pathlib import Path

import pytest

from flight_bridge.gateway import parse_command

EXAMPLES = Path(__file__).resolve().parents[3] / "shared" / "examples" / "drone-command"


def raw(name: str) -> bytes:
    return (EXAMPLES / name).read_bytes()


def test_accepts_valid_upload():
    cmd, ack = parse_command(raw("valid-upload.json"), "ARK-001")
    assert cmd is not None and cmd.mission is not None
    assert ack["accepted"] and ack["commandId"] == "cmd_01JD8X5Q2M9VTRC3B7K4N6P0WY"


def test_accepts_valid_abort():
    cmd, _ = parse_command(raw("valid-abort.json"), "ARK-001")
    assert cmd is not None


@pytest.mark.parametrize("name", ["invalid-abort-with-mission.json", "invalid-upload-no-mission.json"])
def test_refuses_invalid(name):
    cmd, ack = parse_command(raw(name), "ARK-001")
    assert cmd is None and not ack["accepted"] and ack["message"]


def test_refuses_other_drone():
    cmd, ack = parse_command(raw("valid-upload.json"), "ARK-002")
    assert cmd is None and not ack["accepted"]
    assert ack["commandId"] == "cmd_01JD8X5Q2M9VTRC3B7K4N6P0WY"


def test_refuses_garbage():
    cmd, ack = parse_command(b"not json", "ARK-001")
    assert cmd is None and ack["commandId"] is None and len(ack["message"]) <= 300


def test_reboot_is_the_boot_clock_going_back_not_silence():
    from flight_bridge.gateway import Gateway

    g = Gateway("localhost:1883", "tcp:127.0.0.1:1", "ARK-006")
    g.phase = "outbound"
    g._check_reboot(600_000)
    g._check_reboot(605_000)  # a slow sim: later, never earlier
    assert g.phase == "outbound"
    g._check_reboot(2_000)  # SITL respawned
    assert g.phase == "idle"

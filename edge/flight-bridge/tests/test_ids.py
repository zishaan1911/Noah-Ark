import re

from flight_bridge.ids import new_id


def test_format():
    assert re.fullmatch(r"evt_[0-9A-HJKMNP-TV-Z]{26}", new_id("evt"))


def test_unique():
    assert len({new_id("cmd") for _ in range(1000)}) == 1000

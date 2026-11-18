from optimiser import Conditions, DroneState, Order, assign, choose_drone, held_reason, home_key
from routing import Storm


def drone(id_, lat=0.0, lon=0.0, status="available", battery=90.0, max_payload=2.0):
    return DroneState(id_, lat, lon, 0.0, 0.0, status, battery, max_payload)


def order(id_="ord_1", lat=0.05, lon=0.0, payload=1.0, urgency=1, created=0.0):
    return Order(id_, "gdex", lat, lon, payload, urgency, created)


def test_picks_nearer_drone():
    c = choose_drone(order(), [drone("FAR", lat=0.0), drone("NEAR", lat=0.04)], 0, 0)  # the order is at lat 0.05
    assert c is not None
    assert c.drone_id == "NEAR"
    assert c.runner_up == "FAR"


def test_skips_charging():
    c = choose_drone(order(), [drone("A", status="charging"), drone("B", lat=0.02)], 0, 0)
    assert c is not None and c.drone_id == "B"


def test_skips_low_battery():
    assert choose_drone(order(), [drone("A", battery=25.0)], 0, 0) is None


def test_none_when_nothing_fits():
    assert choose_drone(order(), [], 0, 0) is None
    assert choose_drone(order(lat=1.0), [drone("A")], 0, 0) is None  # > 20 km


def test_payload_above_max_skipped():
    assert choose_drone(order(payload=3.0), [drone("A", max_payload=2.0)], 0, 0) is None


def test_tie_goes_to_higher_battery():
    c = choose_drone(order(), [drone("LOW", battery=70.0), drone("HIGH", battery=95.0)], 0, 0)
    assert c is not None and c.drone_id == "HIGH"


def test_assign_urgency_before_age_and_single_use():
    old_low = order("old", urgency=1, created=0.0)
    new_high = order("new", urgency=5, created=100.0)
    out = assign([old_low, new_high], [drone("ONLY")], 0, 0, now_s=200.0)
    assert [c.order_id for c in out] == ["new"]

    out = assign([old_low, new_high], [drone("A"), drone("B", lat=0.01)], 0, 0, now_s=200.0)
    assert [c.order_id for c in out] == ["new", "old"]
    assert len({c.drone_id for c in out}) == 2


def test_no_go_hub_is_skipped():
    held = DroneState("HELD", 0.04, 0.0, 0.04, 0.0, "available", 90.0, 2.0)
    far = drone("FAR")
    cond = Conditions(hub_calls={home_key(0.04, 0.0): ("no_go", "Gusts 17.5 m/s (limit 15)")})
    c = choose_drone(order(), [held, far], 0, 0, conditions=cond)
    assert c is not None and c.drone_id == "FAR"
    assert "hub on hold" in c.rationale and "HELD" in c.rationale


def test_far_held_drone_is_not_mentioned():
    near = drone("NEAR", lat=0.04)
    held_far = DroneState("FARHELD", 0.5, 0.0, 0.5, 0.0, "available", 90.0, 2.0)  # ~50 km away, another hub
    cond = Conditions(hub_calls={home_key(0.5, 0.0): ("no_go", "Storm over the hub")})
    c = choose_drone(order(), [near, held_far], 0, 0, conditions=cond)
    assert c is not None and c.drone_id == "NEAR"
    assert "FARHELD" not in c.rationale


def test_caution_caps_range_at_15_km():
    far_order = order(lat=0.15)  # ~16.7 km
    cond = Conditions(hub_calls={home_key(0.0, 0.0): ("caution", "Rain 12 mm/h (limit 10)")})
    assert choose_drone(far_order, [drone("A")], 0, 0, conditions=cond) is None
    assert choose_drone(far_order, [drone("A")], 0, 0) is not None


def test_storm_between_gives_route():
    cond = Conditions(storms=(Storm("storm-1", 0.05, 0.0, 2.0, 40.0),))
    c = choose_drone(order(lat=0.1), [drone("A")], 0, 0, conditions=cond)
    assert c is not None
    assert len(c.route) >= 1
    assert "around storm-1" in c.rationale
    assert len(c.rationale) <= 400


def test_drop_inside_storm_is_held():
    cond = Conditions(storms=(Storm("storm-1", 0.05, 0.0, 2.0, 45.0),))
    o = order(lat=0.05)
    assert choose_drone(o, [drone("A")], 0, 0, conditions=cond) is None
    reason = held_reason(o, [drone("A")], cond)
    assert reason is not None and "storm-1" in reason


def test_rationale_mentions_drone_and_is_short():
    c = choose_drone(order(), [drone("ARK-104"), drone("ARK-110", lat=0.02)], 3.0, 180)
    assert c is not None
    assert "ARK-104" in c.rationale
    assert len(c.rationale) <= 400

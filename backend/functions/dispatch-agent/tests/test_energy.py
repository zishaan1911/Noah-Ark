from energy import RESERVE_PCT, ground_speed_ms, trip


def test_headwind_slower_than_tailwind():
    # track north (0); wind from north is a headwind, from south a tailwind
    assert ground_speed_ms(0, 5, 0) < ground_speed_ms(0, 5, 180)


def test_ground_speed_floor():
    assert ground_speed_ms(0, 50, 0) == 3.0


def test_design_point_within_budget():
    # ~20 km out and back, 2 kg, no wind (0.18 deg lat ~ 20 km)
    t = trip(0.0, 0.0, 0.18, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0)
    assert 19.0 < t.out_km < 21.0
    assert 100 - t.battery_used_pct >= RESERVE_PCT  # the design point closes with reserve
    assert t.total_min > t.out_min

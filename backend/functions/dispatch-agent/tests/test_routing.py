import itertools
import math

from energy import path_km, path_wh, trip
from routing import STORM_MARGIN_KM, Storm, path_around

A = (0.0, 0.0)
B = (0.1, 0.0)  # ~11.1 km north
KM = 111.195


def storm(lat=0.05, lon=0.0, radius=2.0):
    return Storm("storm-1", lat, lon, radius, 40.0)


def dist_to_leg(p, q, s):
    """Km from the storm centre to leg p-q, in a flat frame around the centre."""

    def xy(pt):
        return ((pt[1] - s.lon) * KM, (pt[0] - s.lat) * KM)

    (px, py), (qx, qy) = xy(p), xy(q)
    dx, dy = qx - px, qy - py
    t = max(0.0, min(1.0, -(px * dx + py * dy) / (dx * dx + dy * dy)))
    return math.hypot(px + t * dx, py + t * dy)


def test_no_storm_is_straight():
    assert path_around(A, B, []) == [A, B]


def test_storm_off_to_the_side_is_straight():
    assert path_around(A, B, [storm(lon=0.2)]) == [A, B]


def test_storm_on_the_line_bends_and_clears():
    s = storm()
    path = path_around(A, B, [s])
    assert path is not None and len(path) >= 3
    for p, q in itertools.pairwise(path):
        assert dist_to_leg(p, q, s) >= s.radius_km + STORM_MARGIN_KM - 0.05


def test_big_storm_over_a_short_leg_still_bends():
    # a 4 km cell in the middle of an 11 km leg: the old one-waypoint detour gave up on this
    s = storm(radius=4.0)
    path = path_around(A, B, [s])
    assert path is not None
    for p, q in itertools.pairwise(path):
        assert dist_to_leg(p, q, s) >= s.radius_km + STORM_MARGIN_KM - 0.05
    assert path_km(path) < 2.2 * path_km([A, B])


def test_destination_inside_is_none():
    assert path_around(A, B, [storm(lat=0.1)]) is None


def test_drone_inside_flies_out_straight():
    assert path_around(A, B, [storm(lat=0.0)]) == [A, B]


def test_trip_with_straight_path_is_unchanged():
    plain = trip(0, 0, 0.1, 0, 0, 0, 1.0, 3.0, 90.0)
    same = trip(0, 0, 0.1, 0, 0, 0, 1.0, 3.0, 90.0, out_path=[A, B], back_path=[B, A])
    assert same == plain


def test_detour_is_longer_and_costs_more():
    path = path_around(A, B, [storm()])
    assert path is not None
    assert path_km(path) > path_km([A, B])
    assert path_wh(path, 3.0, 90.0, 1.0) > path_wh([A, B], 3.0, 90.0, 1.0)
    plain = trip(0, 0, 0.1, 0, 0, 0, 1.0, 3.0, 90.0)
    bent = trip(0, 0, 0.1, 0, 0, 0, 1.0, 3.0, 90.0, out_path=path)
    assert bent.out_km > plain.out_km
    assert bent.battery_used_pct > plain.battery_used_pct

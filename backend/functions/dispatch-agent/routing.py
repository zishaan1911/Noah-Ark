"""Bend a straight leg around storm cells."""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass

from energy import haversine_km

STORM_MARGIN_KM = 1.0
_KM_PER_DEG = math.pi / 180.0 * 6371.0088
_MAX_DEPTH = 3

Point = tuple[float, float]


@dataclass(frozen=True)
class Storm:
    id: str
    lat: float
    lon: float
    radius_km: float
    rain_mm_h: float


def inside(lat: float, lon: float, storm: Storm, margin_km: float = STORM_MARGIN_KM) -> bool:
    """True when the point is within the storm's radius plus margin."""
    return haversine_km(lat, lon, storm.lat, storm.lon) < storm.radius_km + margin_km


def _seg_closest(a: Point, b: Point, c: Point) -> tuple[float, Point]:
    """Clamped projection parameter of c on a-b and the closest point."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    len2 = dx * dx + dy * dy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / len2))
    return t, (a[0] + t * dx, a[1] + t * dy)


def _arc_side(a: Point, b: Point, circle: tuple[float, float, float], ccw: bool) -> list[Point]:
    """Waypoints that take a..b around one side of the circle: leave `a` on a tangent, follow a polygon whose edges
    are tangent to the circle (so no edge cuts it), and arrive at `b` on a tangent."""
    cx, cy, r = circle
    big = r * 1.02  # tangent circle just outside radius + margin, so legs never graze the margin
    sgn = 1.0 if ccw else -1.0

    def tangent_angle(p: Point, leaving: bool) -> float:
        dx, dy = p[0] - cx, p[1] - cy
        alpha = math.acos(min(1.0, big / max(math.hypot(dx, dy), 1e-9)))
        return math.atan2(dy, dx) + (sgn if leaving else -sgn) * alpha

    t1, t2 = tangent_angle(a, True), tangent_angle(b, False)
    sweep = (t2 - t1) % (2 * math.pi) if ccw else -((t1 - t2) % (2 * math.pi))
    n = max(1, math.ceil(abs(sweep) / (math.pi / 4)))
    step = sweep / n
    reach = big / math.cos(step / 2)  # polygon vertex where two tangent edges meet
    return [
        (cx + reach * math.cos(t1 + (k + 0.5) * step), cy + reach * math.sin(t1 + (k + 0.5) * step)) for k in range(n)
    ]


def _length(path: list[Point]) -> float:
    return sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in itertools.pairwise(path))


def _blocked(a: Point, b: Point, circle: tuple[float, float, float]) -> tuple[bool, float]:
    t, p = _seg_closest(a, b, (circle[0], circle[1]))
    return math.hypot(p[0] - circle[0], p[1] - circle[1]) < circle[2], t


def _bend(a: Point, b: Point, circles: list[tuple[float, float, float]], depth: int) -> list[Point] | None:
    """Flat-frame path a..b (inclusive) clear of every circle (cx, cy, radius + margin), or None."""
    hits = [(t, c) for c in circles if (hit := _blocked(a, b, c))[0] for t in (hit[1],)]
    if not hits:
        return [a, b]
    if depth == 0:
        return None
    circle = min(hits, key=lambda h: h[0])[1]  # the first storm along the leg
    best: list[Point] | None = None
    for ccw in (True, False):
        path = [a]
        for p, q in itertools.pairwise([a, *_arc_side(a, b, circle, ccw), b]):
            part = _bend(p, q, [c for c in circles if c is not circle], depth - 1)
            if part is None:
                path = None
                break
            path += part[1:]
        if path is not None and (best is None or _length(path) < _length(best)):
            best = path
    return best


def path_around(a: Point, b: Point, storms: Sequence[Storm]) -> list[Point] | None:
    """Full path [a, waypoints..., b] as (lat, lon); None when b is inside a storm."""
    if any(inside(b[0], b[1], s) for s in storms):
        return None
    if any(inside(a[0], a[1], s) for s in storms):
        return [a, b]  # already in it: the drone flies out
    if not storms:
        return [a, b]
    # shortcut: flat-earth detour, fine under ~50 km; use geodesic maths beyond that.
    cos_lat = math.cos(math.radians(a[0]))

    def flat(p: Point) -> Point:
        return ((p[1] - a[1]) * cos_lat * _KM_PER_DEG, (p[0] - a[0]) * _KM_PER_DEG)

    circles = []
    for s in storms:
        x, y = flat((s.lat, s.lon))
        circles.append((x, y, s.radius_km + STORM_MARGIN_KM))
    flat_path = _bend(flat(a), flat(b), circles, _MAX_DEPTH)
    if flat_path is None:
        return None
    mids = [(a[0] + y / _KM_PER_DEG, a[1] + x / (_KM_PER_DEG * cos_lat)) for x, y in flat_path[1:-1]]
    return [a, *mids, b]

"""Ark float hull: an ellipsoid shell that holds the electronics and floats the whole drone.

Axes: a = half length, b = half width, c = half height. z is measured up from the hull bottom.
"""

import math
from dataclasses import dataclass


@dataclass
class Hull:
    a: float
    b: float
    c: float

    @property
    def volume(self) -> float:
        return 4 / 3 * math.pi * self.a * self.b * self.c

    @property
    def area(self) -> float:
        p = 1.6075  # Knud Thomsen approximation, < 1.1 % error
        ab, ac, bc = (self.a * self.b) ** p, (self.a * self.c) ** p, (self.b * self.c) ** p
        return 4 * math.pi * ((ab + ac + bc) / 3) ** (1 / p)

    @property
    def frontal_area(self) -> float:
        return math.pi * self.b * self.c


def hull_for_volume(volume: float, aspect_width: float, aspect_height: float, min_length: float) -> Hull:
    """Smallest ellipsoid with the given aspect ratios that holds `volume` and is at least `min_length` long."""
    a = max((3 * volume / (4 * math.pi * aspect_width * aspect_height)) ** (1 / 3), min_length / 2)
    return Hull(a, aspect_width * a, aspect_height * a)


def submerged_volume(h: Hull, draft: float) -> float:
    """Volume below the waterline when the bottom sits `draft` below it (ellipsoid cap)."""
    d = min(max(draft, 0.0), 2 * h.c)
    return math.pi * h.a * h.b * d * d * (3 * h.c - d) / (3 * h.c * h.c)


def draft_for(h: Hull, displaced: float) -> float:
    """Draft at which the hull displaces `displaced` m^3. Raises if it would sink."""
    if displaced > h.volume:
        raise ValueError(f"hull sinks: needs {displaced * 1e3:.1f} L, holds {h.volume * 1e3:.1f} L")
    lo, hi = 0.0, 2 * h.c
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if submerged_volume(h, mid) < displaced else (lo, mid)
    return (lo + hi) / 2


def centre_of_buoyancy(h: Hull, draft: float) -> float:
    """Height of the submerged cap's centroid above the hull bottom."""
    d = draft  # a sphere cap's centroid sits 3(2R-d)^2 / 4(3R-d) below the centre; vertical scaling keeps it
    return h.c - 3 * (2 * h.c - d) ** 2 / (4 * (3 * h.c - d))


def metacentric_height(h: Hull, draft: float, kg: float) -> float:
    """GM for roll (the narrow axis, so the less stable one). Positive means it rights itself."""
    shrink = math.sqrt(max(0.0, 1 - ((h.c - draft) / h.c) ** 2))  # waterplane ellipse vs the full one
    a_w, b_w = h.a * shrink, h.b * shrink
    bm = (math.pi * a_w * b_w**3 / 4) / submerged_volume(h, draft)
    return centre_of_buoyancy(h, draft) + bm - kg


def float_check(h: Hull, masses: list[tuple[float, float]], rho_water: float, prop_z: float) -> dict:
    """Float the hull with `masses` = [(kg, z above hull bottom)]; props sit at `prop_z`."""
    total = sum(m for m, _ in masses)
    kg = sum(m * z for m, z in masses) / total
    draft = draft_for(h, total / rho_water)
    return {
        "draft_m": draft,
        "kg_m": kg,
        "gm_m": metacentric_height(h, draft, kg),
        "prop_clearance_m": prop_z - draft,
    }

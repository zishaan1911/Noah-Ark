"""Real ground under the drone: AWS Terrain Tiles (terrarium PNGs, public S3, no key) as a bilinear height field.

`Terrain.ground_z(n, e)` gives the NED z of the ground relative to home, so the physics can rest the skids on real
terrain. NED metres convert to lat/lon exactly like ArduPilot, so the ground matches the autopilot's own position.
"""

from __future__ import annotations

import math
import urllib.request
from collections.abc import Callable
from pathlib import Path

import numpy as np
from PIL import Image

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
CACHE = Path(__file__).resolve().parents[1] / ".cache" / "terrain"
LOCATION_SCALING_FACTOR = 111318.84502145034  # ArduPilot's constant (m per degree) in Location::offset
TILE = 256


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    """H x W x 3 uint8 terrarium pixels -> float32 metres AMSL."""
    c = np.asarray(rgb, dtype=np.float32)
    return (c[..., 0] * 256.0 + c[..., 1] + c[..., 2] / 256.0 - 32768.0).astype(np.float32)


def fetch_tile(z: int, x: int, y: int, cache_dir: Path = CACHE) -> np.ndarray:
    """One 256 x 256 tile in metres AMSL; the raw PNG is cached on disk."""
    path = Path(cache_dir) / str(z) / str(x) / f"{y}.png"
    if not path.exists():
        with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=20) as r:
            data = r.read()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return decode_terrarium(np.asarray(Image.open(path).convert("RGB")))


def _world_px(lat, lon, zoom: int):
    """Web-mercator global pixel coordinates (x east, y south) at this zoom."""
    n = TILE * 2**zoom
    x = (np.asarray(lon, dtype=float) + 180.0) / 360.0 * n
    y = (1.0 - np.arcsinh(np.tan(np.radians(np.asarray(lat, dtype=float)))) / math.pi) / 2.0 * n
    return x, y


class Terrain:
    def __init__(
        self, lat0: float, lon0: float, radius_m: float = 22000.0, zoom: int = 12, fetch: Callable = fetch_tile
    ):
        self.lat0, self.lon0, self.zoom = lat0, lon0, zoom
        dlat = radius_m / LOCATION_SCALING_FACTOR
        dlon = radius_m / (LOCATION_SCALING_FACTOR * math.cos(math.radians(lat0)))
        x_lo, y_lo = _world_px(lat0 + dlat, lon0 - dlon, zoom)  # north-west corner
        x_hi, y_hi = _world_px(lat0 - dlat, lon0 + dlon, zoom)  # south-east corner
        last = 2**zoom - 1
        tx0, tx1 = (min(max(int(v // TILE), 0), last) for v in (x_lo, x_hi))
        ty0, ty1 = (min(max(int(v // TILE), 0), last) for v in (y_lo, y_hi))
        self._x0, self._y0 = tx0 * TILE, ty0 * TILE  # global pixel of the mosaic's top-left corner
        self.h = np.block([[fetch(zoom, x, y, CACHE) for x in range(tx0, tx1 + 1)] for y in range(ty0, ty1 + 1)])
        self.h0 = float(self.height_amsl(lat0, lon0))

    def height_amsl(self, lat, lon):
        """Bilinear height (m AMSL) at lat/lon; scalars or arrays; clamped to the mosaic edge."""
        gx, gy = _world_px(lat, lon, self.zoom)
        hh, ww = self.h.shape
        fx = np.clip(gx - self._x0 - 0.5, 0, ww - 1)  # pixel centres sit at +0.5
        fy = np.clip(gy - self._y0 - 0.5, 0, hh - 1)
        ix, iy = np.minimum(fx.astype(int), ww - 2), np.minimum(fy.astype(int), hh - 2)
        ix, iy = np.maximum(ix, 0), np.maximum(iy, 0)
        ax, ay = fx - ix, fy - iy
        ix1, iy1 = np.minimum(ix + 1, ww - 1), np.minimum(iy + 1, hh - 1)
        top = self.h[iy, ix] * (1 - ax) + self.h[iy, ix1] * ax
        bot = self.h[iy1, ix] * (1 - ax) + self.h[iy1, ix1] * ax
        out = top * (1 - ay) + bot * ay
        return float(out) if out.ndim == 0 else out

    def latlon(self, n, e):
        """NED metres from home -> lat/lon, the same arithmetic as ArduPilot's Location::offset."""
        lat = self.lat0 + np.asarray(n, dtype=float) / LOCATION_SCALING_FACTOR
        lon = self.lon0 + np.asarray(e, dtype=float) / (LOCATION_SCALING_FACTOR * math.cos(math.radians(self.lat0)))
        return lat, lon

    def ground_z(self, n, e):
        """NED z of the ground relative to home (negative = higher than home)."""
        return -(self.height_amsl(*self.latlon(n, e)) - self.h0)

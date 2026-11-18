import numpy as np
import pytest

from ark_sim.model import load
from ark_sim.physics import Sim, World
from ark_sim.terrain import Terrain, decode_terrarium

LAT, LON = 5.7346, 115.9302
M = load()


def const(h: float):
    return lambda z, x, y, cache: np.full((256, 256), h, dtype=np.float32)


def plane(z, x, y, cache):  # rises 1 m per pixel eastward, continuous across tiles
    return np.tile((x * 256 + np.arange(256, dtype=np.float32))[None, :], (256, 1))


def rest(world: World) -> Sim:
    s = Sim(M, world)
    for _ in range(800):
        s.step([1000] * 4, 1 / 400)
    return s


def test_decode_terrarium():
    rgb = np.array([[[128, 0, 0], [128, 10, 128]]], dtype=np.uint8)
    assert decode_terrarium(rgb).ravel() == pytest.approx([0.0, 10.5])  # 128*256 + 10 + 128/256 - 32768


def test_plane_terrain():
    t = Terrain(LAT, LON, fetch=plane)
    assert t.h.shape[1] > 256  # a mosaic of several tiles
    assert t.ground_z(0, 0) == 0
    assert t.ground_z(0, 500.0) < 0  # the ground rises to the east
    h = t.height_amsl(*t.latlon(np.zeros(4001), np.linspace(-20000, 20000, 4001)))
    assert np.all(np.diff(h) > 0) and np.max(np.diff(h)) < 0.5  # no jump at any tile seam


def test_latlon_uses_the_ardupilot_constant():
    t = Terrain(LAT, LON, fetch=const(0))
    lat, lon = t.latlon(1000.0, 0.0)
    assert lat - LAT == pytest.approx(1000 / 111318.845, abs=1e-9)
    assert lon == LON


def test_rests_on_flat_terrain_above_sea_level():
    base = rest(World())
    s = rest(World(terrain=Terrain(LAT, LON, fetch=const(37))))
    assert abs(s.skid_height()) < 0.02
    assert s.p[2] == pytest.approx(base.p[2], abs=0.05)


def test_does_not_sink_into_a_plateau():
    s = rest(World(terrain=Terrain(LAT, LON, fetch=lambda z, x, y, c: plane(z, x, y, c) / 40 + 500)))
    assert s.skid_height() > -0.02

import json

import numpy as np
import pytest
import trimesh
from build_viewer import OUT
from export_glb import export

pytestmark = pytest.mark.skipif(not (OUT / "ark_model.npz").exists(), reason="out/ark_model.npz is missing")


@pytest.fixture(scope="module")
def scene(tmp_path_factory):
    path = tmp_path_factory.mktemp("glb") / "ark1.glb"
    tris, size = export(path)
    assert tris > 0 and size < 8_000_000
    return trimesh.load(path, force="scene"), path


def test_scene_has_the_four_prop_nodes(scene):
    s, _ = scene
    assert {f"prop_{i}" for i in range(1, 5)} <= set(s.graph.nodes)


def test_prop_extras_carry_the_spin_direction(scene):
    _, path = scene
    data = path.read_bytes()
    (jlen,) = np.frombuffer(data[12:16], dtype="<u4")
    nodes = json.loads(data[20 : 20 + int(jlen)])["nodes"]
    dirs = {n["name"]: n["extras"]["dir"] for n in nodes if n.get("name", "").startswith("prop_")}
    assert len(dirs) == 4 and set(dirs.values()) == {-1, 1}


def test_bounds_height_span_and_ground(scene):
    s, _ = scene
    lo, hi = s.bounds
    ext = hi - lo
    assert abs(lo[1]) < 0.01  # y = 0 is ground contact
    assert 0.4 < ext[1] < 0.8  # skid bottom to GNSS puck
    assert 1.0 < max(ext[0], ext[2]) < 2.5  # airframe span


def test_nose_points_to_minus_z(scene):
    s, _ = scene
    if "decal_nose" not in s.graph.nodes:
        pytest.skip("no nose decal to identify the front")
    transform, geom = s.graph["decal_nose"]
    centroid = transform @ np.append(s.geometry[geom].centroid, 1.0)
    assert centroid[2] < 0

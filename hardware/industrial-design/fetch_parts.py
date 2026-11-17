"""Download the few Sketchfab models the electronics viewer uses and turn them into compact, datasheet-scaled .glb files.

    python industrial-design/fetch_parts.py   # needs SKETCHFAB_API_TOKEN in the repo-root .env (never committed)

Each model is re-centred, rotated into the drone frame (x forward, y left, z up), scaled so its bounding box matches
the real part's datasheet size, and written to parts/<stem>.glb. Attribution for every model is in parts/SOURCES.md.
Downloads go to a temporary folder and are treated as untrusted data (only the mesh is read back out of them).
"""

import io
import json
import os
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PARTS = HERE / "parts"
ENV = HERE.parents[1] / ".env"
API = "https://api.sketchfab.com/v3/models/"

# stem: (Sketchfab uid, rows of the rotation from model axes to drone axes, size in metres along drone x, y, z)
# The antenna's whip is a plain cylinder (only its end rings carry vertices), so stretching it to the real length is exact.
MODELS = {
    # RFDesign's 900 MHz half-wave dipole (RP-SMA, 90 degree knuckle): SMA up (+z), whip hanging down, knuckle toward +x
    "antenna_sma_90": ("b1772b0f280d4f2888541e69ae12475f", ((1, 0, 0), (0, 0, -1), (0, 1, 0)), (0.0188, 0.0100, 0.105)),
}


def token() -> str:
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.startswith("SKETCHFAB_API_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"')
    tok = os.environ.get("SKETCHFAB_API_TOKEN")
    if not tok:
        raise SystemExit("SKETCHFAB_API_TOKEN not found in .env or the environment")
    return tok


def download(uid: str, tok: str) -> bytes:
    req = urllib.request.Request(API + uid + "/download", headers={"Authorization": "Token " + tok})
    links = json.load(urllib.request.urlopen(req))
    link = (links.get("glb") or links["gltf"])["url"]
    return urllib.request.urlopen(link).read()


def load_scene(blob: bytes):
    import trimesh  # optional dependency, only needed to refresh the models

    if blob[:4] == b"glTF":
        return trimesh.load(io.BytesIO(blob), file_type="glb", force="scene")
    with tempfile.TemporaryDirectory() as tmp:
        zipfile.ZipFile(io.BytesIO(blob)).extractall(tmp)
        gltf = next(Path(tmp).rglob("*.gltf"))
        return trimesh.load(gltf, force="scene")


def normalise(scene, rot: tuple, size: tuple[float, float, float]):
    """Bake transforms, centre on the bbox, rotate into the drone frame and scale the bbox to the real part's size.

    The vertices are stored in the drone frame (z up), not glTF's y-up, so the viewer adds them to the drone group as is.
    """
    import trimesh

    mesh = scene.to_geometry()
    mesh.apply_translation(-mesh.bounds.mean(axis=0))
    m = np.eye(4)
    m[:3, :3] = np.array(rot, dtype=float)
    mesh.apply_transform(m)
    mesh.apply_scale(np.array(size) / mesh.extents)
    return trimesh.Scene(mesh)


def main() -> int:
    tok = token()
    PARTS.mkdir(exist_ok=True)
    for stem, (uid, rot, size) in MODELS.items():
        scene = normalise(load_scene(download(uid, tok)), rot, size)
        out = PARTS / f"{stem}.glb"
        out.write_bytes(scene.export(file_type="glb"))
        print(f"{stem}: {out.stat().st_size / 1e3:.0f} kB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

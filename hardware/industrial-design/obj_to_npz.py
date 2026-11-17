"""Convert the drone OBJ (3ds Max export, centimetres, y up) into a compact per-part mesh file.

    python industrial-design/obj_to_npz.py   # drone-model/Drone.obj -> drone-model/drone.npz

Each OBJ group becomes one part: float32 positions in metres, z up (x forward stays x), uint32 triangle indices
(quads and n-gons fanned). Normals and UVs are dropped; the viewer recomputes normals.
"""

from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SRC = HERE / "drone-model" / "Drone.obj"
DST = HERE / "drone-model" / "drone.npz"
CM = 0.01


def load(path: Path) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    verts: list[tuple[float, float, float]] = []
    faces: dict[str, list[list[int]]] = {}
    cur = "default"
    with path.open("r", errors="ignore") as f:
        for line in f:
            if line.startswith("v "):
                _, x, y, z = line.split()[:4]
                verts.append((float(x), float(y), float(z)))
            elif line.startswith("g "):
                cur = line[2:].strip() or "default"
            elif line.startswith("f "):
                idx = [int(tok.split("/")[0]) for tok in line.split()[1:]]
                idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
                faces.setdefault(cur, []).extend([idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1))
    v = np.asarray(verts, dtype=np.float64) * CM
    v = np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)  # y up -> z up, keeping a right-handed frame
    parts = {}
    for name, tris in faces.items():
        t = np.asarray(tris, dtype=np.int64)
        used, local = np.unique(t, return_inverse=True)
        parts[name] = (v[used].astype(np.float32), local.reshape(-1, 3).astype(np.uint32))
    return parts


def main() -> int:
    parts = load(SRC)
    np.savez_compressed(
        DST, **{f"{n}::v": v for n, (v, _) in parts.items()}, **{f"{n}::f": f for n, (_, f) in parts.items()}
    )
    allv = np.concatenate([v for v, _ in parts.values()])
    print(f"{len(parts)} parts, {sum(len(f) for _, f in parts.values())} triangles")
    print("bbox (m):", allv.min(0).round(3), allv.max(0).round(3))
    print(f"Wrote {DST} ({DST.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

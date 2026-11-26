"""Track the container's side in the hero clip so the page can pin the GDEX decal to it.

Writes assets/hero/container.js: for each of the 97 frames, [x, y, w, h] as fractions of the
frame, or null before the container is side-on. Masks navy (later silver) pixels, keeps the
largest blob, and interpolates frames where the blob isn't container-shaped (the navy to
silver fade around frame 78).

  python apps/landing/scripts/track_container.py path/to/clip-1080.mp4
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parents[1] / "assets/hero/container.js"
SIDE_ON = 36  # first frame where the container is seen flat from the side


def box(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    b, g, r = (frame[..., i].astype(int) for i in range(3))
    navy = (b - r > 35) & (b > 60) & (b < 200)
    silver = (abs(b - r) < 18) & (abs(g - r) < 18) & (r > 140) & (r < 236)
    m = cv2.morphologyEx(
        ((navy | silver) * 255).astype(np.uint8),
        cv2.MORPH_OPEN,
        np.ones((5, 5), np.uint8),
    )
    n, _, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return None
    x, y, w, h, _ = st[1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))]
    return (int(x), int(y), int(w), int(h)) if w > 500 and 4.5 < w / h < 6.5 else None


def main() -> int:
    cap = cv2.VideoCapture(sys.argv[1])
    found, size = [], None
    while True:
        ok, f = cap.read()
        if not ok:
            break
        size = f.shape[1], f.shape[0]
        found.append(box(f) if len(found) >= SIDE_ON else None)
    assert len(found) == 97 and found[SIDE_ON], f"unexpected clip: {len(found)} frames"
    ok = [i for i, b in enumerate(found) if b]
    W, H = size
    out = []
    for i, b in enumerate(found):
        if i < SIDE_ON:
            out.append(None)
            continue
        if not b:  # interpolate between the nearest good frames
            lo = max(k for k in ok if k < i)
            hi = min((k for k in ok if k > i), default=lo)
            u = 0 if hi == lo else (i - lo) / (hi - lo)
            b = tuple(
                p + (q - p) * u for p, q in zip(found[lo], found[hi], strict=True)
            )
        x, y, w, h = b
        out.append([round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("window.CONTAINER = " + json.dumps(out) + ";\n")
    print(f"{len(ok)} tracked, {97 - SIDE_ON - len(ok)} interpolated -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

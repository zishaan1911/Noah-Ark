"""Render ARK-001 side-on poses for the jungle last-mile scene.

Patches the built viewer (hardware/industrial-design/out/ark_viewer.html) for a transparent
background, poses the drone in headless Edge and writes assets/jungle/ark-<pose>.webp.
Prints the cargo pod's box (fractions of the image) for the parcel drop in index.html.

  python hardware/industrial-design/build_viewer.py      # if the drone changed
  python apps/landing/scripts/render_drone.py
"""

import io
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
VIEWER = ROOT / "hardware/industrial-design/out/ark_viewer.html"
OUT = ROOT / "apps/landing/assets/jungle"
W, H = 1600, 900

# pose -> (nose-down pitch in rad, cargo pod on)
POSES = {
    "cruise": (0.24, True),
    "hover": (0.0, True),
    "empty": (0.0, False),
    "climb": (0.12, False),
}

RIG = """
window.__rig = ({ THREE, camera, controls, ark }) => {
  const k = window.__key; if (!k) return;
  ark.traverse(o => { if (o.material && o.material.type === 'ShadowMaterial') o.visible = false; }); // ground
  ark.rotation.set(-Math.PI / 2, 0, 0); ark.rotateY(k.pitch);
  camera.position.set(0.55, 0.75, 3.0); controls.target.set(0, -0.15, 0); controls.update();
};
"""

CSS = """
html, body { background: transparent !important; overflow: hidden !important; }
body * { visibility: hidden !important; }
#c { visibility: visible !important; position: fixed !important; inset: 0 !important;
     width: 100vw !important; height: 100vh !important; border-radius: 0 !important; z-index: 9999; }
"""


def page_html() -> str:
    src = VIEWER.read_text(encoding="utf-8")
    patches = [
        (
            "new THREE.WebGLRenderer({ canvas, antialias: true })",
            "new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })",
        ),
        (
            "scene.background.encoding = THREE.sRGBEncoding;",
            "scene.background.encoding = THREE.sRGBEncoding; scene.background = null;",
        ),
        (
            "hooks.frame.forEach(f => f(dt));",
            "hooks.frame.forEach(f => f(dt)); if (window.__rig) window.__rig({ THREE, camera, controls, ark });",
        ),
    ]
    for old, new in patches:
        assert src.count(old) == 1, f"viewer changed, patch not found: {old}"
        src = src.replace(old, new)
    head = f"<!doctype html><html><head><meta charset=utf-8><style>{CSS}</style><script>{RIG}</script></head><body>"
    return head + src + "</body></html>"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT.parent / "_render.html"
    tmp.write_text(page_html(), encoding="utf-8")
    shots = {}
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            page = browser.new_page(
                viewport={"width": W, "height": H}, device_scale_factor=1
            )
            page.goto(tmp.as_uri(), wait_until="networkidle")
            page.wait_for_function(
                "() => window.THREE && document.getElementById('t-cargo')"
            )
            for name, (pitch, cargo) in POSES.items():
                page.evaluate(
                    """([pitch, cargo]) => {
                      window.__key = { pitch };
                      const b = document.getElementById('t-cargo');
                      if ((b.getAttribute('aria-pressed') === 'true') !== cargo) b.click();
                    }""",
                    [pitch, cargo],
                )
                page.evaluate(
                    "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))"
                )
                img = Image.open(
                    io.BytesIO(page.screenshot(omit_background=True))
                ).convert("RGBA")
                shots[name] = img
            browser.close()
    finally:
        tmp.unlink(missing_ok=True)
    # one crop for all poses (union of their boxes plus a margin) so they swap in place
    boxes = [im.getchannel("A").getbbox() for im in shots.values()]
    crop = (
        min(b[0] for b in boxes) - 8,
        min(b[1] for b in boxes) - 8,
        max(b[2] for b in boxes) + 8,
        max(b[3] for b in boxes) + 8,
    )
    for name, im in shots.items():
        im.crop(crop).save(OUT / f"ark-{name}.webp", quality=82, method=4)
    cw, ch = crop[2] - crop[0], crop[3] - crop[1]
    x0, y0, x1, y1 = ImageChops.difference(
        shots["hover"].getchannel("A"), shots["empty"].getchannel("A")
    ).getbbox()
    print(f"image {cw}x{ch}")
    print(
        f"pod box: left {(x0 - crop[0]) / cw:.3f} top {(y0 - crop[1]) / ch:.3f}"
        f" right {(x1 - crop[0]) / cw:.3f} bottom {(y1 - crop[1]) / ch:.3f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

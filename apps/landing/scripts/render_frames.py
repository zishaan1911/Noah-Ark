"""Render the hero's drone sequence from the Ark-1 viewer's SITL water landing.

Patches the built viewer (hardware/industrial-design/out/ark_viewer.html) for a transparent
background, scrubs its frozen `#landing-T` hash in headless Edge and writes:
  assets/ark/f_000.webp ... f_096.webp      1280x720, alpha
  assets/ark/sm/f_000.webp ...              640x360, alpha
  assets/ark/frames.js                      per frame: waterline (fraction of frame height) and SITL altitude

The water plane is kept but writes depth only: it hides the submerged part of the pontoons
while the page draws the water itself as a CSS band below the horizon.

  python apps/landing/scripts/render_frames.py            all 97 frames
  python apps/landing/scripts/render_frames.py 0 40 96    just these (for checking)
"""

import io
import itertools
import json
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
VIEWER = ROOT / "hardware/industrial-design/out/ark_viewer.html"
OUT = ROOT / "apps/landing/assets/ark"
N = 97
W, H = (
    1280,
    720,
)  # shortcut: 720p frames to keep the render quick, 1080p if the hero looks soft

# frame -> (landing time T in s since the SITL clip start, camera distance m, camera height above the drone m)
# SITL: hover at ~20 m, FIRE at T=8, touchdown at T~32.9, disarm a few s later. The camera follows the drone.
KEYS = [
    (0, 4.0, 3.0, 0.35),
    (6, 4.0, 3.0, 0.35),
    (24, 12.0, 3.0, 0.35),  # pontoons inflate
    (40, 27.0, 3.0, 0.35),  # descent
    (62, 33.5, 3.0, 0.35),  # approach and touchdown
    (72, 36.0, 3.0, 0.35),  # settle, props stop
    (90, 38.0, 4.8, 1.45),  # camera pulls back
    (96, 38.0, 4.8, 1.45),  # hold
]
SITL = ROOT / "simulation/results/water_landing.json"


def ease(u: float) -> float:
    return u * u * (3 - 2 * u)


def key_at(f: int) -> tuple[float, float, float]:
    for (f0, *a), (f1, *b) in itertools.pairwise(KEYS):
        if f <= f1:
            u = ease((f - f0) / (f1 - f0))
            return tuple(x + (y - x) * u for x, y in zip(a, b))
    return tuple(KEYS[-1][1:])


RIG = """
window.__rig = ({ THREE, camera, controls, water, ark }) => {
  const k = window.__key; if (!k) return;
  ark.traverse(o => { if (o.geometry && /Ring|Cone/.test(o.geometry.type)) o.visible = false; }); // ripples, radar beam
  Object.assign(water.material, { colorWrite: false, transparent: false, depthWrite: true });
  water.renderOrder = -1;
  const wy = water.getWorldPosition(new THREE.Vector3()).y;
  const dir = new THREE.Vector3(1.45, 0, 1.65).normalize();
  const tgt = new THREE.Vector3(0, -0.12, 0);
  camera.position.copy(dir.clone().multiplyScalar(k.dist)).setY(tgt.y + k.height);
  controls.target.copy(tgt); controls.update();
  camera.updateMatrixWorld();
  const under = new THREE.Vector3(0, wy, 0).project(camera); // the water right under the drone
  window.__wl = Math.min(1.02, (1 - under.y) / 2);
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
            "hooks.frame.forEach(f => f(dt)); if (window.__rig) window.__rig({ THREE, camera, controls, water, ark });",
        ),
    ]
    for old, new in patches:
        assert src.count(old) == 1, f"viewer changed, patch not found: {old}"
        src = src.replace(old, new)
    head = f"<!doctype html><html><head><meta charset=utf-8><style>{CSS}</style><script>{RIG}</script></head><body>"
    return head + src + "</body></html>"


def main() -> int:
    only = [int(a) for a in sys.argv[1:]]
    frames = only or list(range(N))
    (OUT / "sm").mkdir(parents=True, exist_ok=True)
    tmp = OUT.parent / "_render.html"
    tmp.write_text(page_html(), encoding="utf-8")
    data_path = OUT / "frames.js"
    data = (
        json.loads(data_path.read_text().split("=", 1)[1].strip().rstrip(";"))
        if data_path.exists()
        else {"waterline": [1.02] * N, "alt": [0.0] * N}
    )
    wl, alt = data["waterline"], data["alt"]
    sitl = json.loads(SITL.read_text())
    ix, t0 = sitl["track_cols"].index, sitl["fire_t_s"] - 8
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            page = browser.new_page(
                viewport={"width": W, "height": H}, device_scale_factor=1
            )
            page.on(
                "console", lambda m: m.type == "error" and print("console:", m.text)
            )
            page.goto(tmp.as_uri(), wait_until="networkidle")
            page.wait_for_function(
                "() => window.THREE && document.querySelector('#c').width > 0"
            )
            for f in frames:
                t, dist, height = key_at(f)
                page.evaluate(
                    "k => { window.__key = k; location.hash = 'landing-' + k.t.toFixed(3); }",
                    {"t": t, "dist": dist, "height": height},
                )
                page.evaluate(
                    "() => new Promise(r => { let n = 2; const s = () => --n ? requestAnimationFrame(s) : r(); requestAnimationFrame(s); })"
                )
                wl[f] = round(page.evaluate("() => window.__wl"), 4)
                row = min(sitl["track"], key=lambda r: abs(r[0] - (t0 + t)))
                alt[f] = round(max(row[ix("skid_h")], 0.0), 2)
                img = Image.open(
                    io.BytesIO(page.screenshot(omit_background=True))
                ).convert("RGBA")
                img.save(OUT / f"f_{f:03d}.webp", quality=70, method=2)
                img.resize((W // 2, H // 2), Image.LANCZOS).save(
                    OUT / "sm" / f"f_{f:03d}.webp", quality=65, method=2
                )
                print(f"frame {f:3d}  T={t:5.2f}  waterline={wl[f]}")
            browser.close()
    finally:
        tmp.unlink(missing_ok=True)
        data_path.write_text("window.ARK_FRAMES = " + json.dumps(data) + ";\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

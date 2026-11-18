"""Build the Ark-1 3D viewer page from the edited model and ark.json.

    python industrial-design/build_viewer.py   # out/ark_model.npz + ark.json -> out/ark_viewer.html

One geometry edit happens here: the motor pods are widened to the real T-Motor MN801-S diameter. Meshes are quantised to uint16 per part to keep the page small.
"""

import base64
import json
import re
import sys
from html import escape
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant  # ARK_VARIANT picks Ark-1 or a variant folder

ARK_JSON = variant.ARK_JSON
OUT = variant.OUT


def widen_radially(v: np.ndarray, diameter: float) -> np.ndarray:
    c = v[:, :2].mean(axis=0)
    r = np.hypot(v[:, 0] - c[0], v[:, 1] - c[1]).max()
    out = v.copy()
    out[:, :2] = c + (v[:, :2] - c) * (diameter / 2 / r)
    return out


def pack(v: np.ndarray, f: np.ndarray) -> dict:
    lo, hi = v.min(axis=0), v.max(axis=0)
    span = np.where(hi - lo > 0, hi - lo, 1.0)
    q = np.round((v - lo) / span * 65535).astype("<u2")
    big = len(v) > 65535
    return {
        "lo": lo.round(6).tolist(),
        "span": span.round(6).tolist(),
        "v": base64.b64encode(q.tobytes()).decode(),
        "f": base64.b64encode(f.astype("<u4" if big else "<u2").tobytes()).decode(),
        "f32": big,
    }


def main() -> int:
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    idc = ark["industrial_design"]
    res = idc["result"]
    d = np.load(OUT / "ark_model.npz")
    motor_d = next(p for p in ark["candidates"]["propulsion"] if p["name"] == ark["chosen"]["propulsion"])[
        "motor_size_m"
    ][0]
    parts = {}
    for name in sorted({k.split("::")[0] for k in d.files}):
        v, f = d[name + "::v"].astype(np.float64), d[name + "::f"]
        if name.startswith("GEO_Base"):
            v = widen_radially(v, motor_d)
        parts[name] = pack(v, f)
    props = np.concatenate([d[k] for k in d.files if k.startswith("GEO_Propeller") and k.endswith("::v")])
    livery = {
        p.stem: "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
        for p in sorted((HERE / "livery").glob("*.png"))
    }
    # optional inputs owned by the electronics and pontoon work: part models (glTF binary), harness netlist, pontoon system
    models = {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted((HERE / "parts").glob("*.glb"))}
    extra = {
        k: json.loads((variant.ID_DATA / f).read_text(encoding="utf-8"))
        for k, f in (("harness", "harness.json"), ("pontoon_system", "pontoon_system.json"))
        if (variant.ID_DATA / f).exists()
    }
    # flown scenarios from ../../simulation (optional): the water landing keeps its track for the replay
    sitl = {}
    for f in sorted((HERE.parents[1] / "simulation" / "results").glob("*.json")):
        r = json.loads(f.read_text(encoding="utf-8"))
        if f.stem != "water_landing":
            r = {k: v for k, v in r.items() if k not in ("track", "events")}
        sitl[f.stem] = r
    data = {
        "sitl": (sitl or None) if not variant.NAME else None,  # the flown SITL tracks are Ark-1's
        "variant": {"name": ark.get("name", "Ark-1"), "livery": idc.get("livery")},
        "req": {k: ark["requirements"][k] for k in ("range_out_km", "range_back_km", "payload_kg")},
        "mission": idc.get("mission", {}).get("result"),
        "models": models,
        **extra,
        "livery": livery,
        "span_m": round(float(np.hypot(props[:, 0], props[:, 1]).max()) * 2, 3),
        "parts": parts,
        "id": {k: idc[k] for k in ("pontoon", "added_mass_kg")} | {"result": res},
        "chosen": {
            "pack": res["battery"]["pack"],
            "pack_kg": res["battery"]["pack_kg"],
            "pack_kwh": res["battery"]["pack_wh"] / 1000,
            "flight_min": ark["chosen"]["flight_time_min"],
            "propulsion": ark["chosen"]["propulsion"],
        },
        "power": {
            "hover_rpm": ark["power_chain"]["hover"]["rpm"],
            "esc_eff": ark["power_chain"]["esc_hover_low_pack"]["efficiency"],
            "low_pack_v_cell": ark["power_chain"]["bus"]["low"]["vcell_min_peak"],
        },
    }
    html = (HERE / "viewer_template.html").read_text(encoding="utf-8")
    if "__ARK_DATA__" not in html or "/*__MODULES__*/" not in html:
        raise ValueError("template needs the __ARK_DATA__ and /*__MODULES__*/ placeholders")
    # viewer/NN_*.js run inside the page's one function scope, in file-name order (they share its variables)
    modules = "\n".join(p.read_text(encoding="utf-8") for p in sorted((HERE / "viewer").glob("*.js")))
    html = html.replace("/*__MODULES__*/", modules)
    name, tagline = ark.get("name", "Ark-1"), ark.get("tagline", "amphibious")
    html = html.replace("<title>Ark-1</title>", f"<title>{name}</title>")
    html = html.replace("<h1>Ark-1 <span>amphibious</span></h1>", f"<h1>{name} <span>{tagline}</span></h1>")
    html = html.replace('aria-label="3D model of Ark-1.', f'aria-label="3D model of {name}.')
    if blurb := ark.get("blurb"):  # a variant's own intro and its changes on top of Ark-1's list
        html = re.sub(
            r'<p class="sub">.*?</p>', lambda _: f'<p class="sub">{escape(blurb)}</p>', html, count=1, flags=re.DOTALL
        )
    extra = "".join(f"<li><b>{escape(b)}</b> {escape(t)}</li>" for b, t in ark.get("changes", []))
    html = html.replace('<ul class="changes">', '<ul class="changes">' + extra, 1)
    out = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else OUT / "ark_viewer.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html.replace("__ARK_DATA__", json.dumps(data)), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

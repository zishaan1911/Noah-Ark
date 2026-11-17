"""Build the Ark-1 3D viewer page from the edited model and ark.json.

    python industrial-design/build_viewer.py   # out/ark_model.npz + ark.json -> out/ark_viewer.html

Two geometry edits happen here: the battery housing is stretched to hold the chosen pack, and the motor pods are
widened to the real T-Motor MN801-S diameter. Meshes are quantised to uint16 per part to keep the page small.
"""

import base64
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ARK_JSON = HERE.parent / "ark.json"
OUT = HERE / "out"


def stretch_x(v: np.ndarray, extra: float) -> np.ndarray:
    lo, hi = v[:, 0].min(), v[:, 0].max()
    c = (lo + hi) / 2
    out = v.copy()
    out[:, 0] = c + (v[:, 0] - c) * (hi - lo + extra) / (hi - lo)
    return out


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
        if name == "Battery":
            v = stretch_x(v, res["battery"]["housing_stretch_m"][0])
        if name.startswith("GEO_Base"):
            v = widen_radially(v, motor_d)
        parts[name] = pack(v, f)
    props = np.concatenate([d[k] for k in d.files if k.startswith("GEO_Propeller") and k.endswith("::v")])
    data = {
        "span_m": round(float(np.hypot(props[:, 0], props[:, 1]).max()) * 2, 3),
        "parts": parts,
        "id": {k: idc[k] for k in ("pontoon", "added_mass_kg")} | {"result": res},
        "chosen": {
            "pack": ark["chosen"]["pack"],
            "pack_kg": ark["chosen"]["mass_kg"]["pack"],
            "pack_kwh": ark["chosen"]["energy_wh"]["pack"] / 1000,
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
    if "__ARK_DATA__" not in html:
        raise ValueError("template has no __ARK_DATA__ placeholder")
    out = OUT / "ark_viewer.html"
    out.write_text(html.replace("__ARK_DATA__", json.dumps(data)), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

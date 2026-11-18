"""Does the Ark-1 airframe (the team's model, as edited) still fly the mission? Re-run the mission energy with its
real all-up mass and its own drag, using sizing's power model.

    python industrial-design/mission_check.py   # reads ark.json + out/ark_model.npz, writes industrial_design.mission

Drag: frontal area of every part seen from ahead (rasterised silhouette of the mesh on the y-z plane) x a bluff-body
drag coefficient; the cargo pod and the stowed pontoon packs add their own frontal areas. The 20 km out / 20 km back
mission, reserve and hover times are sizing's requirements.
"""

import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant  # ARK_VARIANT picks Ark-1 or a variant folder

ARK_JSON = variant.ARK_JSON
sys.path.insert(0, str(HERE.parent / "sizing"))
from size_ark import best_cruise, hover_power

ROTORS = 4


def frontal_area(v: np.ndarray, f: np.ndarray, cell: float = 0.002) -> float:
    """Silhouette area of a mesh seen along x: rasterise every triangle's (y, z) projection onto a grid."""
    lo = v[:, 1:].min(0)
    ny, nz = (np.ceil((v[:, 1:].max(0) - lo) / cell).astype(int) + 1).tolist()
    grid = np.zeros((ny, nz), dtype=bool)
    yz = (v[:, 1:] - lo) / cell
    for a, b, c in f:
        p = yz[[a, b, c]]
        i0, j0 = np.floor(p.min(0)).astype(int)
        i1, j1 = np.ceil(p.max(0)).astype(int)
        if i1 - i0 > 400 or j1 - j0 > 400:
            continue  # shortcut: skip degenerate giant triangles, none exist in this model
        ii, jj = np.meshgrid(np.arange(i0, i1 + 1), np.arange(j0, j1 + 1), indexing="ij")
        q = np.stack([ii.ravel() + 0.5, jj.ravel() + 0.5], 1)
        d1 = (p[1] - p[0])[0] * (q[:, 1] - p[0][1]) - (p[1] - p[0])[1] * (q[:, 0] - p[0][0])
        d2 = (p[2] - p[1])[0] * (q[:, 1] - p[1][1]) - (p[2] - p[1])[1] * (q[:, 0] - p[1][0])
        d3 = (p[0] - p[2])[0] * (q[:, 1] - p[2][1]) - (p[0] - p[2])[1] * (q[:, 0] - p[2][0])
        inside = ((d1 >= 0) & (d2 >= 0) & (d3 >= 0)) | ((d1 <= 0) & (d2 <= 0) & (d3 <= 0))
        ok = inside & (q[:, 0] < ny) & (q[:, 1] < nz)
        grid[q[ok, 0].astype(int), q[ok, 1].astype(int)] = True
    return float(grid.sum() * cell * cell)


def mission(ark: dict, auw: float, cda: float, cda_payload: float, pack_wh: float) -> dict:
    req, env, cand = ark["requirements"], ark["environment"], ark["candidates"]
    prop = next(p for p in cand["propulsion"] if p["name"] == ark["chosen"]["propulsion"])
    d = prop["prop_in"] * 0.0254
    area = math.pi * d * d / 4
    g, rho = env["g"], env["rho_air"]
    w_out, w_back = auw * g, (auw - req["payload_kg"]) * g
    vr = req["cruise_speed_range_mps"]
    e_out, v_out = best_cruise(w_out, req["range_out_km"] * 1e3, cda + cda_payload, area, prop, rho, vr)
    e_back, v_back = best_cruise(w_back, req["range_back_km"] * 1e3, cda, area, prop, rho, vr)
    fm, eta = prop["fm"], prop["eta_drive"]
    e_hover = (
        hover_power(w_out, area, fm, eta, rho) * (req["hover_out_s"] + req["water_ops_s"])
        + hover_power(w_back, area, fm, eta, rho) * req["hover_back_s"]
    )
    mission_wh = (e_out + e_back + e_hover) / 3600
    needed = mission_wh / (1 - req["reserve_frac"])
    usable = pack_wh * cand["usable_dod"]
    return {
        "mission_wh": round(mission_wh, 1),
        "needed_with_reserve_wh": round(needed, 1),
        "usable_wh": round(usable, 1),
        "energy_margin": round(usable / needed, 4),
        "cruise_mps": [v_out, v_back],
        "twr": round(ROTORS * prop["max_thrust_kg"] / auw, 3),
    }


def main() -> int:
    ark = json.loads(ARK_JSON.read_text(encoding="utf-8"))
    idc = ark["industrial_design"]
    res = idc["result"]
    d = np.load(variant.OUT / "ark_model.npz")
    # every airframe part except the props (rotor drag is in the power model), merged into one mesh
    names = sorted(n for n in {k.split("::")[0] for k in d.files} if not n.startswith("GEO_Propeller"))
    verts, faces, base = [], [], 0
    for n in names:
        verts.append(d[n + "::v"])
        faces.append(d[n + "::f"].astype(np.int64) + base)
        base += len(d[n + "::v"])
    a_body = frontal_area(np.concatenate(verts).astype(np.float64), np.concatenate(faces))
    cd_body = idc.get("mission", {}).get("cd_body", 0.9)  # bluff multirotor body, conservative
    pt = idc["pontoon"]
    a_packs = 2 * math.pi * (pt["stowed_d_m"] / 2) ** 2
    cda = cd_body * a_body + 0.5 * a_packs
    pod = ark["mechanical"]["pod"]["size_m"]
    cda_payload = 0.9 * pod[1] * pod[2]
    auw = res["auw_estimate_kg"]
    s = ark["candidates"]["series_cells"]
    cell = next(c for c in ark["candidates"]["cells"] if c["name"] == ark["chosen"]["cell"])
    p_now = int(res["battery"]["pack"].removesuffix("P").split("S")[1])  # the pack the airframe carries now
    out = {
        "frontal_area_m2": round(a_body, 4),
        "cd_body": cd_body,
        "cda_m2": round(cda, 4),
        "cda_payload_m2": round(cda_payload, 4),
        "auw_kg": auw,
    }
    # current pack, and the smallest pack that closes the mission if the current one does not
    pack_cell_kg = s * cell["kg"] * (1 + ark["candidates"]["pack_overhead_frac"])
    for p in range(p_now, p_now + 4):
        extra = (p - p_now) * pack_cell_kg
        r = mission(ark, auw + extra, cda, cda_payload, s * p * cell["ah"] * cell["v_nom"])
        out[f"12S{p}P"] = r | {"auw_kg": round(auw + extra, 3)}
        if r["energy_margin"] >= 1.0:
            out["closes_with"] = f"12S{p}P"
            break
    idc["mission"] = {"cd_body": cd_body} | {"result": out}
    ARK_JSON.write_text(json.dumps(ark, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

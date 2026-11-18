"""Check Ark-1's wiring harness (harness.json) against the airframe and the power chain, and write a summary back.

    python industrial-design/harness.py   # harness.json + ark.json + out/ark_model.npz -> harness.json "checks"

What it checks:
- netlist: every port is used by exactly the wires that name it (no dangling port, no unknown end), both ends of each
  wire agree on the voltage domain, and ports marked `spare` stay unconnected;
- copper: every wire's gauge carries its continuous current within a standard AWG ampacity table, and its short peak
  within PEAK_FACTOR x that; every connector is rated for the current through it (per contact);
- fit: every internal component's box lies inside the shell's cavity, internal components don't overlap, every wire
  route stays inside the cavity with its own radius of clearance, and a route only leaves the shell through a declared
  passthrough (cable gland, bulkhead connector) on its way to an external component.

The cavity is the enclosed air inside GEO_Main_Body (hub, arms, belly well, leg tubes), found by voxelising the shell
and flood-filling the outside. The model's rear battery slot is open, so a rear service hatch closes it (the viewer
draws the same hatch); seams under SEAM_CLOSE voxels between the legs and the shelf are closed the same way.
"""

import hashlib
import itertools
import json
import math
import re
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import variant  # ARK_VARIANT picks Ark-1 or a variant folder

ARK_JSON = variant.ARK_JSON
HARNESS = variant.ID_DATA / "harness.json"
MODEL = variant.OUT / "ark_model.npz"
CACHE = variant.OUT / "shell_cavity.npz"

VOXEL_M = 0.003
GRID_LO = (-0.46, -0.46, -0.61)
GRID_HI = (0.46, 0.46, 0.04)
SEAM_CLOSE = 2  # voxels: closes modelling seams up to ~12 mm wide (leg/shelf joints) before the flood fill
SEED = (0.0, 0.0, -0.10)  # a point that is surely inside the hub
REAR_HATCH = {"x_m": (-0.279, -0.272), "y_m": (-0.10, 0.10), "z_m": (-0.23, -0.07)}  # plugs the old battery slot
SHELL_PARTS = ("GEO_Main_Body", "GEO_Base_01", "GEO_Base_02", "GEO_Base_03", "GEO_Base_04")

# Chassis-wiring ampacity (single conductor in free air), A. Source: the common Handbook-of-Electronic-Tables figures
# as tabulated at https://www.powerstream.com/Wire_Size.htm ("Maximum amps for chassis wiring").
AMPACITY_A = {6: 101, 8: 73, 10: 55, 12: 41, 14: 32, 16: 22, 18: 16, 20: 11, 22: 7, 24: 3.5, 26: 2.2, 28: 1.4, 30: 0.86}
# Short peaks (the sizing's thrust-to-weight manoeuvre lasts seconds) may run this far over the chassis rating: the
# silicone insulation is rated 200 C against the table's 60 C rise basis.
PEAK_FACTOR = 1.5
COPPER_KG_M3 = 8960
SAMPLE_M = 0.004  # route sampling step
END_ZONE_M = 0.012  # samples this close to a passthrough or an external port are where the cable meets the wall
PORT_TOL_M = 0.004


def awg_diameter_m(awg: int) -> float:
    return 0.000127 * 92 ** ((36 - awg) / 39)


def awg_area_m2(awg: int) -> float:
    return math.pi * awg_diameter_m(awg) ** 2 / 4


# ---------------------------------------------------------------- shell cavity (voxels)
def _surface_voxels(v: np.ndarray, f: np.ndarray, lo: np.ndarray, shape: tuple, vox: float) -> np.ndarray:
    """Mark every voxel a triangle passes through, by sampling each triangle on a grid finer than the voxel."""
    solid = np.zeros(shape, bool)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    edge = np.maximum.reduce(
        [np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1), np.linalg.norm(c - b, axis=1)]
    )
    steps = np.ceil(edge / (vox * 0.5)).astype(int) + 1
    for k in np.unique(steps):
        sel = steps == k
        u, w = np.meshgrid(np.arange(k + 1), np.arange(k + 1))
        keep = (u + w) <= k
        u, w = u[keep] / k, w[keep] / k
        p = (
            a[sel, None]
            + (b[sel, None] - a[sel, None]) * u[None, :, None]
            + (c[sel, None] - a[sel, None]) * w[None, :, None]
        )
        idx = np.floor((p.reshape(-1, 3) - lo) / vox).astype(int)
        idx = idx[np.all((idx >= 0) & (idx < shape), axis=1)]
        solid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    return solid


class Shell:
    """Voxel model of the airframe: `cavity` (enclosed air), `outside` (free air), and clearance to the shell for each."""

    def __init__(self, cavity: np.ndarray, outside: np.ndarray, lo: np.ndarray, vox: float):
        from scipy import ndimage

        self.cavity, self.outside, self.lo, self.vox = cavity, outside, lo, vox
        # distance from a voxel centre to the nearest voxel of another kind, less half a voxel (the wall surface lies
        # somewhere inside the wall voxel): a conservative clearance
        self.clear_in = np.maximum(ndimage.distance_transform_edt(cavity) - 0.5, 0) * vox
        self.clear_out = np.maximum(ndimage.distance_transform_edt(outside) - 0.5, 0) * vox

    def _idx(self, p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        idx = np.floor((np.atleast_2d(p) - self.lo) / self.vox).astype(int)
        ok = np.all((idx >= 0) & (idx < self.cavity.shape), axis=1)
        return np.clip(idx, 0, np.array(self.cavity.shape) - 1), ok

    def inside(self, p: np.ndarray, clearance: float = 0.0) -> np.ndarray:
        idx, ok = self._idx(p)
        i, j, k = idx.T
        return ok & self.cavity[i, j, k] & (self.clear_in[i, j, k] >= clearance - 1e-9)

    def outside_free(self, p: np.ndarray, clearance: float = 0.0) -> np.ndarray:
        idx, ok = self._idx(p)
        i, j, k = idx.T
        return ~ok | (self.outside[i, j, k] & (self.clear_out[i, j, k] >= clearance - 1e-9))

    def clearance_in(self, p: np.ndarray) -> np.ndarray:
        idx, ok = self._idx(p)
        i, j, k = idx.T
        return np.where(ok & self.cavity[i, j, k], self.clear_in[i, j, k], -1.0)


def build_shell(model: Path = MODEL, cache: Path = CACHE) -> Shell:
    from scipy import ndimage

    key = hashlib.sha1(
        model.read_bytes() + json.dumps([VOXEL_M, GRID_LO, GRID_HI, SEAM_CLOSE, REAR_HATCH, SHELL_PARTS]).encode()
    ).hexdigest()
    lo, vox = np.array(GRID_LO), VOXEL_M
    if cache.exists():
        c = np.load(cache)
        if str(c["key"]) == key:
            return Shell(c["cavity"], c["outside"], lo, vox)
    d = np.load(model)
    shape = tuple(np.ceil((np.array(GRID_HI) - lo) / vox).astype(int))
    solid = np.zeros(shape, bool)
    for name in SHELL_PARTS:
        solid |= _surface_voxels(d[name + "::v"].astype(np.float64), d[name + "::f"], lo, shape, vox)
    h = REAR_HATCH
    a = np.floor((np.array([h["x_m"][0], h["y_m"][0], h["z_m"][0]]) - lo) / vox).astype(int)
    b = np.floor((np.array([h["x_m"][1], h["y_m"][1], h["z_m"][1]]) - lo) / vox).astype(int) + 1
    solid[a[0] : b[0], a[1] : b[1], a[2] : b[2]] = True
    closed = ndimage.binary_dilation(solid, iterations=SEAM_CLOSE)
    labels, _ = ndimage.label(~closed)
    seed = tuple(np.floor((np.array(SEED) - lo) / vox).astype(int))
    if labels[seed] == labels[0, 0, 0]:
        raise ValueError("the hub cavity leaks to the outside: close the gap or raise SEAM_CLOSE")
    cavity = ndimage.binary_dilation(labels == labels[seed], iterations=SEAM_CLOSE) & ~solid
    outside = ~solid & ~cavity
    cache.parent.mkdir(exist_ok=True)
    np.savez_compressed(cache, key=key, cavity=cavity, outside=outside)
    return Shell(cavity, outside, lo, vox)


# ---------------------------------------------------------------- harness model
def dumps(h: dict) -> str:
    """JSON with each innermost list (a point, a pin list) on one line, so routes read one point per line."""

    def flat(m: re.Match) -> str:
        return json.dumps(json.loads(m.group(0)), ensure_ascii=False)

    return re.sub(r"\[[^\[\]{}]*\]", flat, json.dumps(h, indent=1, ensure_ascii=False)) + "\n"


def load(path: Path = HARNESS) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def ports(h: dict) -> dict[str, dict]:
    out = {}
    for c in h["components"]:
        for p in c["ports"]:
            out[f"{c['id']}.{p['id']}"] = p | {"component": c}
    return out


def route_length(route: list) -> float:
    r = np.asarray(route, float)
    return float(np.linalg.norm(np.diff(r, axis=0), axis=1).sum())


def wire_od_m(h: dict, w: dict) -> float:
    """Outside diameter of the cable as drawn and checked: single conductor, a bundle, or a coax."""
    if w.get("cable"):
        return h["cables"][w["cable"]]["od_mm"] / 1000
    od = h["insulated_od_mm"][str(w["awg"])] / 1000
    n = w.get("conductors", 1)
    return od if n == 1 else od * math.sqrt(n) * 1.15  # round bundle of n wires


def copper_kg(w: dict, length: float) -> float:
    if w.get("awg") is None:
        return 0.0
    return awg_area_m2(w["awg"]) * length * w.get("conductors", 1) * COPPER_KG_M3


def sample_route(route: list, step: float = SAMPLE_M) -> np.ndarray:
    r = np.asarray(route, float)
    pts = [r[0]]
    for a, b in itertools.pairwise(r):
        n = max(math.ceil(np.linalg.norm(b - a) / step), 1)
        pts.extend(a + (b - a) * (i / n) for i in range(1, n + 1))
    return np.array(pts)


def box_points(c: dict, n: int = 5) -> np.ndarray:
    """Grid of points on and in a component's box (yaw about z), in the drone frame."""
    s = np.array(c["size"]) / 2
    g = np.linspace(-1, 1, n)
    local = np.stack(np.meshgrid(g, g, g, indexing="ij"), -1).reshape(-1, 3) * s
    yaw = math.radians(c.get("yaw_deg", 0))
    rot = np.array([[math.cos(yaw), -math.sin(yaw), 0], [math.sin(yaw), math.cos(yaw), 0], [0, 0, 1]])
    return local @ rot.T + np.array(c["pos"])


def boxes_overlap(a: dict, b: dict) -> bool:
    """Separating-axis test for two boxes that may be yawed about z (2D SAT in plan + a z interval test)."""
    if abs(a["pos"][2] - b["pos"][2]) >= (a["size"][2] + b["size"][2]) / 2:
        return False

    def corners(c: dict) -> np.ndarray:
        s = np.array(c["size"][:2]) / 2
        yaw = math.radians(c.get("yaw_deg", 0))
        rot = np.array([[math.cos(yaw), -math.sin(yaw)], [math.sin(yaw), math.cos(yaw)]])
        return np.array([[sx, sy] for sx in (-s[0], s[0]) for sy in (-s[1], s[1])]) @ rot.T + np.array(c["pos"][:2])

    ca, cb = corners(a), corners(b)
    for c in (ca, cb):
        for e in (c[1] - c[0], c[2] - c[0]):
            axis = np.array([-e[1], e[0]]) / np.linalg.norm(e)
            pa, pb = ca @ axis, cb @ axis
            if pa.max() <= pb.min() or pb.max() <= pa.min():
                return False
    return True


# ---------------------------------------------------------------- checks
def check_netlist(h: dict) -> list[str]:
    errs = []
    pt = ports(h)
    used: dict[str, list[str]] = {k: [] for k in pt}
    ids = [w["id"] for w in h["wires"]]
    errs += [f"duplicate wire id {i}" for i in sorted({i for i in ids if ids.count(i) > 1})]
    for w in h["wires"]:
        for end in ("from", "to"):
            if w[end] not in pt:
                errs.append(f"{w['id']}: {end} end {w[end]} is not a port")
            else:
                used[w[end]].append(w["id"])
        if w["from"] in pt and w["to"] in pt:
            a, b = pt[w["from"]], pt[w["to"]]
            if a["domain"] != b["domain"] or w["domain"] != a["domain"]:
                errs.append(
                    f"{w['id']}: domain {w['domain']} joins {w['from']} ({a['domain']}) to {w['to']} ({b['domain']})"
                )
            r = w["route"]
            for end, p in (("from", a), ("to", b)):
                q = r[0] if end == "from" else r[-1]
                if np.linalg.norm(np.subtract(q, p["at"])) > PORT_TOL_M:
                    errs.append(f"{w['id']}: route does not start/end at {w[end]} ({q} vs {p['at']})")
    for k, p in pt.items():
        want = 0 if p.get("spare") else p.get("wires", 1)
        if len(used[k]) != want:
            errs.append(f"port {k} has {len(used[k])} wires, expected {want} ({', '.join(used[k]) or 'dangling'})")
    return errs


def check_copper(h: dict, ark: dict) -> list[str]:
    errs = []
    pt = ports(h)
    currents = design_currents(ark)
    ratings = h["connector_ratings"]
    for w in h["wires"]:
        i_cont, i_peak = wire_current(w, currents)
        if w.get("awg") is not None:
            amp = AMPACITY_A[w["awg"]]
            if i_cont > amp or i_peak > PEAK_FACTOR * amp:
                errs.append(f"{w['id']}: {w['awg']} AWG ({amp} A) too thin for {i_cont:.1f} A / peak {i_peak:.1f} A")
        for end in ("from", "to"):
            con = pt[w[end]]["connector"] if w[end] in pt else None
            if con not in ratings:
                errs.append(f"{w['id']}: connector '{con}' at {w[end]} has no rating")
                continue
            rate = ratings[con]
            n = w.get("contacts_per_conductor", 1)
            if i_cont > rate["cont_a"] * n or i_peak > rate["peak_a"] * n:
                errs.append(f"{w['id']}: {con} ({rate['cont_a']} A) under-rated for {i_cont:.1f} A / {i_peak:.1f} A")
    return errs


def check_fit(h: dict, shell: Shell) -> list[str]:
    errs = []
    comps = {c["id"]: c for c in h["components"]}
    glands = [np.array(c["pos"]) for c in h["components"] if c.get("passthrough")]
    internal = [c for c in h["components"] if c["location"] == "internal"]
    for c in internal:
        if not shell.inside(box_points(c)).all():
            errs.append(f"component {c['id']} is not fully inside the shell")
    for i, a in enumerate(internal):
        for b in internal[i + 1 :]:
            related = a.get("mounted_on") == b["id"] or b.get("mounted_on") == a["id"]
            if not related and boxes_overlap(a, b):
                errs.append(f"components {a['id']} and {b['id']} overlap")
    pt = ports(h)
    for w in h["wires"]:
        r = shell.vox  # one voxel of slack: the conservative clearance under-reads by up to that
        rad = max(wire_od_m(h, w) / 2 - r, 0.0)
        anchors = list(glands)
        for end in ("from", "to"):
            if w[end] in pt and comps[pt[w[end]]["component"]["id"]]["location"] == "external":
                anchors.append(np.array(pt[w[end]]["at"]))
        pts = sample_route(w["route"])
        far = np.ones(len(pts), bool)
        for a in anchors:
            far &= np.linalg.norm(pts - a, axis=1) > END_ZONE_M
        ok = shell.inside(pts, rad) | shell.outside_free(pts, rad)
        bad = far & ~ok
        if bad.any():
            p = pts[np.argmax(bad)]
            errs.append(f"wire {w['id']}: route touches or crosses the shell wall at {np.round(p, 3).tolist()}")
            continue
        # every switch between inside and outside must happen at a passthrough or an external port
        side = shell.inside(pts)
        for k in np.flatnonzero(side[1:] != side[:-1]):
            if far[k] and far[k + 1]:
                errs.append(f"wire {w['id']}: leaves the shell without a passthrough at {np.round(pts[k], 3).tolist()}")
                break
    return errs


def design_currents(ark: dict) -> dict[str, float]:
    """Named design currents (A) the harness refers to, from the sizing and the SPICE power chain."""
    bus = ark["power_chain"]["bus"]
    pack_cont = max(bus["full"]["ipack_hover"], bus["low"]["ipack_hover"])
    pack_peak = max(ark["chosen"]["pack_peak_current_a"], bus["full"]["ipack_peak"], bus["low"]["ipack_peak"])
    # a variant may cap the motor current in the flight controller (ArduCopter MOT_BAT_CURR_MAX); SPICE still runs the
    # uncapped peak, which is the harder case for bus sag
    pack_peak = min(pack_peak, ark["electrical"].get("mot_bat_curr_max_a", math.inf))
    duty_max = ark["electrical"]["esc"]["duty_max"]
    return {
        "pack": pack_cont,
        "pack_peak": pack_peak,
        "esc": pack_cont / 4,
        "esc_peak": pack_peak / 4,
        "phase": ark["power_chain"]["esc_hover_low_pack"]["iph_rms_a"],
        "phase_peak": pack_peak / 4 / duty_max,
    }


def wire_current(w: dict, currents: dict[str, float]) -> tuple[float, float]:
    """(continuous, peak) current: a named design current, or the wire's own `current_a` / `peak_a` figures."""
    if "current" in w:
        return currents[w["current"]], currents[w["current"] + "_peak"]
    return w.get("current_a", 0.0), w.get("peak_a", w.get("current_a", 0.0))


def summary(h: dict, ark: dict) -> dict:
    lengths = {w["id"]: route_length(w["route"]) for w in h["wires"]}
    longest = max(lengths, key=lengths.get)
    comp_g = sum(c.get("mass_g", 0) * c.get("qty", 1) for c in h["components"] if not c.get("drawn_by"))
    cu = sum(copper_kg(w, lengths[w["id"]]) for w in h["wires"])
    return {
        "components": len(h["components"]),
        "ports": sum(len(c["ports"]) for c in h["components"]),
        "wires": len(h["wires"]),
        "conductors": sum(w.get("conductors", 1) for w in h["wires"]),
        "total_length_m": round(sum(lengths.values()), 2),
        "copper_kg": round(cu, 3),
        "longest_run": {"wire": longest, "length_m": round(lengths[longest], 3)},
        "component_mass_kg": round(comp_g / 1000, 3),
        "design_currents_a": {k: round(v, 1) for k, v in design_currents(ark).items()},
        "wire_lengths_m": {k: round(v, 3) for k, v in lengths.items()},
    }


def run(h: dict, ark: dict, shell: Shell | None) -> dict:
    errs = check_netlist(h) + check_copper(h, ark)
    if shell is not None:
        errs += check_fit(h, shell)
    return {"ok": not errs, "errors": errs, "fit_checked": shell is not None, **summary(h, ark)}


def main() -> int:
    h, ark = load(), json.loads(ARK_JSON.read_text(encoding="utf-8"))
    shell = build_shell() if MODEL.exists() else None
    res = run(h, ark, shell)
    h["checks"] = res
    HARNESS.write_text(dumps(h), encoding="utf-8")
    print(
        f"{res['components']} components, {res['ports']} ports, {res['wires']} wires ({res['conductors']} conductors), "
        f"{res['total_length_m']} m, {res['copper_kg'] * 1000:.0f} g copper; longest {res['longest_run']['wire']} "
        f"{res['longest_run']['length_m']} m; shell fit {'checked' if shell else 'NOT checked (no out/ark_model.npz)'}"
    )
    for e in res["errors"]:
        print("  FAIL", e)
    print("OK" if res["ok"] else f"{len(res['errors'])} problems")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

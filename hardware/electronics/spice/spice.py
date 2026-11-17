"""Thin ngspice batch runner: .param overrides, {KEY} substitutions, .meas parsing."""

import os
import re
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build"


def ngspice_path() -> str | None:
    return (
        os.environ.get("NGSPICE")
        or shutil.which("ngspice_con")
        or shutil.which("ngspice")
        or next((p for p in [r"C:\msys64\mingw64\bin\ngspice_con.exe"] if Path(p).exists()), None)
    )


def run(cir: str, name: str, params: dict | None = None, subs: dict | None = None, timeout: int = 600) -> dict:
    """Run netlist `cir` with overrides; return its .meas results as {name: float}."""
    exe = ngspice_path()
    if not exe:
        raise FileNotFoundError("ngspice not found: install it or set NGSPICE")
    src = (HERE / cir).read_text(encoding="utf-8")
    for k, v in (params or {}).items():
        src, n = re.subn(rf"^\.param {k}=\S+", f".param {k}={v}", src, flags=re.MULTILINE)
        if n != 1:
            raise KeyError(f"{cir}: .param {k} not found")
    for k, v in (subs or {}).items():
        src = src.replace("{" + k + "}", str(v))
    BUILD.mkdir(exist_ok=True)
    path = BUILD / f"{name}.cir"
    path.write_text(src, encoding="utf-8")
    r = subprocess.run([exe, "-b", str(path)], check=False, capture_output=True, text=True, cwd=BUILD, timeout=timeout)
    log = r.stdout + r.stderr
    (BUILD / f"{name}.log").write_text(log, encoding="utf-8")
    meas = {}
    for line in r.stdout.splitlines():
        m = re.match(r"^\s*([a-z_]\w*)\s*=\s*([-+]?[0-9.]+(?:e[-+]?\d+)?)", line, re.IGNORECASE)
        if m:
            meas[m.group(1).lower()] = float(m.group(2))
    errors = [ln for ln in log.splitlines() if re.search(r"\berror\b", ln, re.IGNORECASE) and "code model" not in ln]
    if errors or not meas:
        raise RuntimeError(f"{name} failed:\n" + "\n".join(errors[:20] or log.splitlines()[-30:]))
    return meas

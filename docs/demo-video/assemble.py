"""Joins the segment clips (per-part speed, crossfades) and lays music under them.
python assemble.py <out.mp4> <outro clip name> <music spec>
music spec: one track for the whole video   "inspired.mp3"
            or a score, section=track[@drop] "01=backtoyou.mp3,02=dreamer.mp3,05=skyhigh.mp3@drop,..."
            (a section runs until the next listed one; @drop starts the song at its first loud part, @42 at 42 s)."""

import json
import subprocess
import sys

import numpy as np

HERE = __file__.rsplit("/", 1)[0] + "/"
MUSIC = HERE + "music/"
XF = 0.6  # video crossfade, s
out, outro, spec = sys.argv[1], sys.argv[2], sys.argv[3]

# (section id, clip, speed, trim start, trim end); GDEX splits into launch, time-lapse cruise, arrival
g = json.load(open(HERE + "clips/07-gdex.json"))
cruise = g["cruiseEnd"] - g["cruiseStart"]
PARTS = [
    ("01", "01-intro", 1.1, None, None),
    ("02", "02-landing", 1.3, None, None),
    ("03", "03-partyrock", 1.3, None, None),
    ("04", "04-android", 1.3, None, None),
    ("05", "05-fleet", 1.25, None, None),
    ("06", "06-phone-update", 1.0, None, None),
    ("07", "07-gdex", 1.6, 0, g["cruiseStart"]),
    ("07", "07-gdex", max(4.0, cruise / 22), g["cruiseStart"], g["cruiseEnd"]),
    ("07", "07-gdex", 4.0, g["cruiseEnd"], g["landed"] - 6),
    ("07", "07-gdex", 1.0, g["landed"] - 6, g["end"]),
    ("08", "08-defence", 1.5, None, None),
    ("09", "09-drone", 1.3, None, None),
    ("10", outro, 1.0, None, None),
]


def probe(path):
    return float(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                path,
            ]
        )
    )


def drop_at(path):
    """Seconds where the song first gets loud (its first drop), from a 0.5 s RMS envelope."""
    pcm = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            path,
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "-",
        ]
    )
    x = np.frombuffer(pcm, np.int16).astype(np.float32)
    w = 4000
    rms = np.sqrt((x[: len(x) // w * w].reshape(-1, w) ** 2).mean(1))
    loud = np.convolve(rms, np.ones(8) / 8, "same")  # 4 s smoothing
    i = int(np.argmax(loud > 0.85 * loud.max()))
    return max(0.0, i * 0.5 - 1.0)


args, chains, lens, starts = [], [], [], {}
for i, (sec, name, sp, a, b) in enumerate(PARTS):
    path = f"{HERE}clips/{name}.mp4"
    total_in = probe(path)
    a = a or 0.0
    b = total_in if b is None else b
    args += ["-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", path]
    lens.append((b - a) / sp)
    chains.append(f"[{i}:v]setpts=PTS/{sp},fps=30,format=yuv420p,settb=1/30[v{i}]")
prev, t = "v0", lens[0]
starts["01"] = 0.0
for i in range(1, len(PARTS)):
    t -= XF
    starts.setdefault(PARTS[i][0], t)
    chains.append(
        f"[{prev}][v{i}]xfade=transition=fade:duration={XF}:offset={t:.3f}[x{i}]"
    )
    prev, t = f"x{i}", t + lens[i]
total = t

# music: one track looped, or one track per listed section with 2 s crossfades
items = [s.split("=") for s in spec.split(",")] if "=" in spec else [["01", spec]]
plan = []
for k, (sec, tr) in enumerate(items):
    file, _, mode = tr.partition("@")
    t0 = starts[sec]
    t1 = starts[items[k + 1][0]] if k + 1 < len(items) else total
    plan.append((file, mode, t0, t1))
ai, mix = len(PARTS), []
for k, (file, mode, t0, t1) in enumerate(plan):
    path = MUSIC + file
    src = drop_at(path) if mode == "drop" else float(mode or 0)
    need = t1 - t0 + 2.0
    n = probe(path)
    fin, fout = (0.3 if k == 0 else 2.0), (5.0 if k == len(plan) - 1 else 2.0)
    loop = "aloop=loop=-1:size=2e9," if n - src < need else ""
    args += ["-ss", f"{src:.2f}", "-i", path]
    chains.append(
        f"[{ai}:a]{loop}atrim=0:{need:.3f},asetpts=PTS-STARTPTS,afade=t=in:d={fin},"
        f"afade=t=out:st={need - fout:.3f}:d={fout},adelay={int(max(0, t0 - (0 if k == 0 else 1.0)) * 1000)}:all=1[m{k}]"
    )
    mix.append(f"[m{k}]")
    ai += 1
chains.append(
    f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0,atrim=0:{total:.3f},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]"
)
cmd = [
    "ffmpeg",
    "-y",
    "-v",
    "error",
    *args,
    "-filter_complex",
    ";".join(chains),
    "-map",
    f"[{prev}]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "19",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
]
subprocess.run(cmd, check=True)
print(
    f"{out}: {total:.1f} s; sections "
    + ", ".join(f"{s}@{v:.0f}s" for s, v in starts.items())
)

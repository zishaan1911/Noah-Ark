"""Original ambient background track (no samples, no licences): soft pads, a bass pulse and a slow arpeggio.
python bgm.py <seconds> <out.wav>"""

import sys
import wave

import numpy as np

SR = 44100
dur = float(sys.argv[1])
n = int(dur * SR)
t = np.arange(n) / SR

# Am - F - C - G, 8 s per chord
CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]]
BAR = 8.0


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(x, a, r):
    return np.clip(x / a, 0, 1) * np.clip((BAR - x) / r, 0, 1)


L = np.zeros(n)
R = np.zeros(n)
for i in range(int(np.ceil(dur / BAR))):
    s, e = int(i * BAR * SR), min(n, int((i + 1) * BAR * SR + 2 * SR))
    if s >= n:
        break
    tt = t[s:e] - i * BAR
    ch = CHORDS[i % 4]
    pad_env = np.clip(tt / 2.5, 0, 1) * np.clip((BAR + 2 - tt) / 3.0, 0, 1)
    for k, m in enumerate(ch):
        f = hz(m)
        for det, pan in ((-0.12, 0.3), (0.12, 0.7)):  # two detuned voices, panned
            v = np.sin(2 * np.pi * (f + det) * tt) + 0.25 * np.sin(
                2 * np.pi * 2 * (f + det) * tt
            )
            v *= pad_env * 0.045
            L[s:e] += v * (1 - pan)
            R[s:e] += v * pan
    # bass: root an octave down, gentle pulse every 2 s
    f = hz(ch[0] - 12)
    pulse = np.exp(-(tt % 2.0) * 1.6) * (tt < BAR)
    b = np.sin(2 * np.pi * f * tt) * pulse * 0.10
    L[s:e] += b
    R[s:e] += b
    # arpeggio: chord tones an octave up, 8th notes at 75 bpm-ish
    step = 0.4
    for j in range(int(BAR / step)):
        m = ch[[0, 1, 2, 3, 2, 1][j % 6]] + 12
        a0 = j * step
        seg = (tt >= a0) & (tt < a0 + 1.6)
        x = tt[seg] - a0
        v = np.sin(2 * np.pi * hz(m) * x) * np.exp(-x * 3.2) * 0.03
        pan = 0.25 + 0.5 * ((j % 4) / 3)
        L[s:e][seg] += v * (1 - pan)
        R[s:e][seg] += v * pan

# simple echo for space
d = int(0.375 * SR)
for buf in (L, R):
    buf[d:] += 0.28 * buf[:-d].copy()

fade = np.clip(t / 3, 0, 1) * np.clip((dur - t) / 4, 0, 1)
out = np.stack([L, R], 1) * fade[:, None]
out /= np.abs(out).max() / 0.8
assert np.isfinite(out).all()
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes())

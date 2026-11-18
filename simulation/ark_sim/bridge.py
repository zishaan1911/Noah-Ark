"""Couples the physics to ArduPilot SITL.

- Physics: SITL's JSON backend sends the servo PWMs over UDP (port 9002) every loop; we step the sim and answer
  with the state as one JSON line. SITL waits for the answer (lockstep), so sim time runs as fast as we compute.
- Pontoon wiring: SITL GPIO lives in the SIM_PIN_MASK param. The relays (ARM, FIRE_L, FIRE_R) are pins 0..2,
  the active-low pressure switches pins 3 and 4. A MAVLink link on SERIAL1 hears every mask change (SITL
  notifies the GCS) to fire the inflators, and writes the switch bits back when a tube reaches pressure.
"""

from __future__ import annotations

import json
import math
import socket
import struct
import threading
import time

from pymavlink import mavutil

from .physics import Sim, euler

PIN = {"ARM": 0, "L": 1, "R": 2, "PS_L": 3, "PS_R": 4}


class Bridge:
    def __init__(self, sim: Sim, port: int = 9002, mav_url: str = "tcp:127.0.0.1:5762", rec_hz: float = 10.0):
        self.sim, self.port, self.mav_url = sim, port, mav_url
        self.track: list[list[float]] = []
        self.rec_every = 1.0 / rec_hz
        self._next_rec = 0.0
        self.mask = 1 << PIN["PS_L"] | 1 << PIN["PS_R"]
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.frames = 0

    def start(self) -> None:
        threading.Thread(target=self._physics, daemon=True).start()
        threading.Thread(target=self._pins, daemon=True).start()

    # ---- physics over UDP
    def _physics(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("0.0.0.0", self.port))
        sock.settimeout(0.5)
        last_frame, reply = -1, b""
        while not self.stop.is_set():
            try:
                data, addr = sock.recvfrom(256)
            except TimeoutError:
                continue
            magic, rate, frame = struct.unpack_from("<HHI", data)
            if magic not in (18458, 29569):
                continue
            n = 16 if magic == 18458 else 32
            pwm = struct.unpack_from(f"<{n}H", data, 8)
            if frame != last_frame:  # a repeated frame is a resend: answer again without stepping
                with self.lock:
                    self.sim.step(pwm, 1.0 / max(rate, 1))
                    reply = ("\n" + json.dumps(self.sim.json_state()) + "\n").encode()
                    self._record()
                last_frame = frame
                self.frames += 1
            sock.sendto(reply, addr)

    def _record(self) -> None:
        s = self.sim
        if s.t < self._next_rec:
            return
        self._next_rec = s.t + self.rec_every
        r, p, y = euler(s.q)
        self.track.append(
            [
                round(s.t, 2),
                *(round(float(v), 3) for v in s.p),
                *(round(math.degrees(a), 1) for a in (r, p, y)),
                round(s.inflation("L"), 3),
                round(s.inflation("R"), 3),
                round(float(s.thrust.sum()), 1),
                round(s.v_bus, 2),
                round(s.skid_height(), 3),
                round(float(s.world.surface(s.p[0], s.p[1], s.t)[0]) - s.p[2], 3),
            ]
        )

    TRACK_COLS = ("t", "n", "e", "d", "roll", "pitch", "yaw", "infl_L", "infl_R", "thrust_n", "v_bus", "skid_h", "cg_h")

    # ---- pontoon wiring over MAVLink (SIM_PIN_MASK)
    def _pins(self) -> None:
        while not self.stop.is_set():
            try:
                mav = mavutil.mavlink_connection(self.mav_url, source_system=250, autoreconnect=True)
                break
            except OSError:
                time.sleep(0.5)
        mav.wait_heartbeat(timeout=60)
        mav.mav.param_request_read_send(mav.target_system, mav.target_component, b"SIM_PIN_MASK", -1)
        armed = {"L": False, "R": False}
        last_set = 0.0
        while not self.stop.is_set():
            msg = mav.recv_match(type="PARAM_VALUE", blocking=True, timeout=0.2)
            if msg and msg.param_id == "SIM_PIN_MASK":
                self.mask = int(msg.param_value)
                print(f"[{self.sim.t:7.1f}] pins {self.mask:05b}", flush=True)
                for side in ("L", "R"):
                    on = bool(self.mask >> PIN["ARM"] & 1) and bool(self.mask >> PIN[side] & 1)
                    if on and not armed[side]:
                        with self.lock:
                            self.sim.fire(side)  # rising edge of ARM and FIRE together: one pulse
                    armed[side] = on
            want = self.mask
            for side in ("L", "R"):
                bit = 1 << PIN["PS_" + side]
                want = want & ~bit if self.sim.pressure_ok(side) else want | bit
            # shortcut: read-modify-write of a mask SITL also writes (relays); a relay edge landing inside the
            #   ~50 ms round trip could be overwritten. Fine for these scenarios; a SITL GPIO input hook removes it.
            if want != self.mask and time.monotonic() - last_set > 0.3:
                mav.mav.param_set_send(
                    mav.target_system, mav.target_component, b"SIM_PIN_MASK", want, mavutil.mavlink.MAV_PARAM_TYPE_INT16
                )
                last_set = time.monotonic()

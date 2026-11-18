"""Ark-1 6-DOF flight and water physics, stepped by ArduPilot SITL through the JSON interface.

Body FRD, world NED (origin at the launch point, z down). One step = one SITL loop: four ESC PWMs in, the vehicle
state out. Motors are DC-equivalent BLDC with back-EMF and a prop load, fed by a 12S pack with sag; the
pontoons inflate on the timing from pontoon_system.json and float on a wave field.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .model import Model


@dataclass
class World:
    shore_n: float = 40.0  # m north of the launch point: land south of it, water north of it
    bank_m: float = 0.5  # water surface this far below the launch pad
    hs: float = 0.0  # significant wave height, m
    tp: float = 2.5  # peak wave period, s (short-fetch flood water)
    wave_dir_deg: float = 0.0  # direction the waves travel to, from north
    wind_ned: tuple = (0.0, 0.0, 0.0)  # m/s, the air's velocity
    gust: float = 0.0  # m/s, std of the gust on each axis
    seed: int = 1
    all_water: bool = False  # start floating: no land anywhere

    def __post_init__(self):
        rng = np.random.default_rng(self.seed)
        n = 6
        w_p = 2 * math.pi / self.tp
        self.w = w_p * np.linspace(0.7, 1.6, n)
        self.k = self.w**2 / 9.81  # deep-water dispersion
        self.a = np.full(n, self.hs / 4 * math.sqrt(2 / n))  # sum a^2 / 2 = (Hs / 4)^2
        th = math.radians(self.wave_dir_deg) + rng.uniform(-0.4, 0.4, n)
        self.kx, self.ky = self.k * np.cos(th), self.k * np.sin(th)
        self.phi = rng.uniform(0, 2 * math.pi, n)
        self._g = np.zeros(3)
        self._rng = rng

    def is_water(self, n: float) -> bool:
        return self.all_water or n >= self.shore_n

    def surface(self, n, e, t: float):
        """(z of the surface, NED; its vertical velocity, NED) under (n, e); scalars or arrays."""
        n, e = np.asarray(n, dtype=float), np.asarray(e, dtype=float)
        ph = np.multiply.outer(n, self.kx) + np.multiply.outer(e, self.ky) - self.w * t + self.phi
        eta = (self.a * np.cos(ph)).sum(axis=-1)
        deta = (self.a * self.w * np.sin(ph)).sum(axis=-1)
        water = self.all_water | (n >= self.shore_n)
        return np.where(water, self.bank_m - eta, 0.0), np.where(water, -deta, 0.0)

    def wind(self, dt: float) -> np.ndarray:
        # gust: Ornstein-Uhlenbeck, 2 s correlation, std `gust`
        tau = 2.0
        self._g += -self._g / tau * dt + self.gust * math.sqrt(2 * dt / tau) * self._rng.standard_normal(3)
        return np.array(self.wind_ned) + self._g * np.array([1, 1, 0.3])


def quat_to_dcm(q: np.ndarray) -> np.ndarray:
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )


def euler(q: np.ndarray) -> tuple[float, float, float]:
    w, x, y, z = q
    roll = math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y))
    pitch = math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x))))
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    return roll, pitch, yaw


@dataclass
class Faults:
    """Inflator faults per side: pulses that do not release the latch (0 = healthy; 99 = never)."""

    dead_pulses: dict = field(default_factory=lambda: {"L": 0, "R": 0})


class Sim:
    SLICES = 10
    K_GROUND, C_GROUND, MU = 20000.0, 900.0, 0.6
    C_FRICTION = 500.0  # N s/m per skid point: stiff enough to hold, soft enough for a 400 Hz explicit step
    C_WATER_LIN = 120.0  # N s/m per metre of fully wetted tube (wave-radiation damping, est.)

    def __init__(self, m: Model, world: World, start_floating: bool = False, soc: float = 1.0, faults=None):
        self.m, self.world, self.faults = m, world, faults or Faults()
        self.t = 0.0
        self.q = np.array([1.0, 0, 0, 0])
        self.w = np.zeros(3)
        self.v = np.zeros(3)
        self.omega = np.zeros(4)
        self.soc = soc
        self.v_bus = self.ocv()
        self.i_bus = 0.0
        self.fire_t: dict[str, float | None] = {"L": None, "R": None}
        self.pulses = {"L": 0, "R": 0}
        self.sunk = False
        self.min_prop_clear = math.inf
        if start_floating:
            self.fire_t = {"L": -100.0, "R": -100.0}
            z_surf, _ = world.surface(0, 0, 0)
            self.p = np.array([0.0, 0.0, float(z_surf) - m.tube_pos[0, 2]])
        else:
            self.p = np.array([0.0, 0.0, -float(np.max(m.skid_pts[:, 2]))])  # skids on the pad
        self.thrust = np.zeros(4)
        self.accel_body = np.array([0, 0, -m.g])
        ds = m.tube_len / self.SLICES
        xs = (np.arange(self.SLICES) + 0.5) * ds - m.tube_len / 2
        self._slice_body = np.concatenate([tp + np.column_stack([xs, 0 * xs, 0 * xs]) for tp in m.tube_pos])
        self._ds = ds
        cyl = math.pi * m.tube_d**2 / 4
        self._kvol = (cyl * (m.tube_len - m.tube_d) + math.pi * m.tube_d**3 / 6) / (
            cyl * m.tube_len
        )  # hemispherical ends

    # ---- pontoons
    def fire(self, side: str) -> None:
        self.pulses[side] += 1
        if self.fire_t[side] is None and self.pulses[side] > self.faults.dead_pulses[side]:
            self.fire_t[side] = self.t

    def inflation(self, side: str) -> float:
        t0 = self.fire_t[side]
        return 0.0 if t0 is None else min(max((self.t - t0) / self.m.inflate_full_s, 0.0), 1.0)

    def pressure_ok(self, side: str) -> bool:
        t0 = self.fire_t[side]
        return t0 is not None and self.t - t0 >= self.m.inflate_ok_s

    # ---- power
    def ocv(self) -> float:
        m, s = self.m, self.soc
        cell = m.ocv_low + (m.ocv_full - m.ocv_low) * (s - 0.2) / 0.8 if s >= 0.2 else 3.0 + (m.ocv_low - 3.0) * s / 0.2
        return m.cells_s * cell

    # ---- one SITL step
    def step(self, pwm, dt: float) -> None:
        m = self.m
        duty = m.duty_max * np.clip((np.asarray(pwm[:4], dtype=float) - 1000) / 1000, 0, 1)
        i_m = (self.v_bus * duty - m.ke * self.omega) / m.r_motor  # ESC with active braking: current can reverse
        load = m.k_torque * self.omega**2 + m.ke * m.i0 * (self.omega > 1)
        domega = (m.ke * i_m - load) / m.j_rotor
        self.omega = np.maximum(self.omega + domega * dt, 0.0)
        self.i_bus = float(np.sum(duty * i_m)) + m.avionics_w / self.v_bus
        self.v_bus = self.ocv() - max(self.i_bus, 0.0) * m.r_pack
        self.soc -= self.i_bus * dt / 3600 / m.capacity_ah

        thrust = m.k_thrust * self.omega**2
        self.thrust = thrust
        f_b = np.zeros(3)
        f_b[2] = -float(np.sum(thrust))
        tau = np.cross(m.rotor_pos, np.stack([np.zeros(4), np.zeros(4), -thrust], axis=1)).sum(axis=0)
        tau[2] += float(np.sum(m.rotor_dir * (m.k_torque * self.omega**2 + m.j_rotor * domega)))

        R = quat_to_dcm(self.q)
        f_w = R @ f_b + np.array([0, 0, m.mass * m.g])

        # air drag on the relative wind
        v_air = self.v - self.world.wind(dt)
        sp = float(np.linalg.norm(v_air))
        if sp > 1e-6:
            cda = m.cda + (m.cda_vertical - m.cda) * (v_air[2] / sp) ** 2
            f_w += -0.5 * m.rho_air * cda * sp * v_air
        tau += -0.4 * self.w  # rotor and airframe rotational damping (est.)

        fw2, tw2 = self._contacts(R)
        f_w += fw2
        tau += R.T @ tw2

        # integrate (semi-implicit Euler)
        acc = f_w / m.mass
        self.v = self.v + acc * dt
        self.p = self.p + self.v * dt
        I = m.inertia
        wdot = np.linalg.solve(I, tau - np.cross(self.w, I @ self.w))
        self.w = self.w + wdot * dt
        wx, wy, wz = self.w
        qd = (
            0.5
            * np.array(
                [
                    [0, -wx, -wy, -wz],
                    [wx, 0, wz, -wy],
                    [wy, -wz, 0, wx],
                    [wz, wy, -wx, 0],
                ]
            )
            @ self.q
        )
        self.q = self.q + qd * dt
        self.q /= np.linalg.norm(self.q)
        self.accel_body = R.T @ (acc - np.array([0, 0, m.g]))
        self.t += dt
        self._prop_clearance(R)

    def _contacts(self, R: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Ground (skids) and water (pontoon slices): world force and world moment about the CG."""
        m, wd = self.m, self.world
        f, tq = np.zeros(3), np.zeros(3)
        rw = m.skid_pts @ R.T
        P = self.p + rw
        on = (P[:, 2] > 0) & ~(wd.all_water | (P[:, 0] >= wd.shore_n))  # ground at z = 0
        if on.any():
            rw, P = rw[on], P[on]
            vp = self.v + np.cross(R @ self.w, rw)
            fn = np.maximum(self.K_GROUND * P[:, 2] + self.C_GROUND * vp[:, 2], 0.0)
            ft = -self.C_FRICTION * vp[:, :2]
            n_ft = np.linalg.norm(ft, axis=1)
            scale = np.minimum(1.0, self.MU * fn / np.maximum(n_ft, 1e-9))
            F = np.column_stack([ft * scale[:, None], -fn])
            f += F.sum(axis=0)
            tq += np.cross(rw, F).sum(axis=0)
        fr = np.array([self.inflation("L"), self.inflation("R")])
        if fr.any():
            r = m.tube_d / 2 * np.sqrt(np.repeat(fr, self.SLICES))
            rb = self._slice_body
            rw = rb @ R.T
            P = self.p + rw
            zs, vzs = wd.surface(P[:, 0], P[:, 1], self.t)
            water = wd.all_water | (P[:, 0] >= wd.shore_n)
            depth = np.clip(P[:, 2] - zs, -r, r)
            h = r + depth
            with np.errstate(invalid="ignore", divide="ignore"):
                a = np.where(
                    r > 0,
                    r * r * np.arccos(np.clip((r - h) / np.maximum(r, 1e-9), -1, 1))
                    - (r - h) * np.sqrt(np.maximum(2 * r * h - h * h, 0.0)),
                    0.0,
                )
            a = np.where(water, a * self._kvol, 0.0)
            wet = np.where(r > 0, a / np.maximum(np.pi * r * r, 1e-12), 0.0)
            vp = self.v + np.cross(R @ self.w, rw)
            vp[:, 2] -= vzs
            ds = self._ds
            F = np.zeros_like(vp)
            F[:, 2] = -m.rho_water * m.g * a * ds
            sp = np.linalg.norm(vp, axis=1)
            F += -(0.5 * m.rho_water * (2 * r * ds * wet) * sp + self.C_WATER_LIN * ds * wet)[:, None] * vp
            f += F.sum(axis=0)
            tq += np.cross(rw, F).sum(axis=0)
        # the hub in the water with no floats under it: the drone is lost
        zc, _ = wd.surface(self.p[0], self.p[1], self.t)
        if wd.is_water(self.p[0]) and self.p[2] > float(zc) + 0.05:
            self.sunk = True
        return f, tq

    def _prop_clearance(self, R: np.ndarray) -> None:
        if not self.world.is_water(self.p[0]):
            return
        n = R[:, 2]  # disc normal (body down) in the world
        down = np.array([0, 0, 1.0])
        tilt = down - (down @ n) * n
        tn = float(np.linalg.norm(tilt))
        low = tilt / tn * self.m.prop_r if tn > 1e-6 else np.zeros(3)
        P = self.p + self.m.prop_pts @ R.T + low
        zs, _ = self.world.surface(P[:, 0], P[:, 1], self.t)
        self.min_prop_clear = min(self.min_prop_clear, float(np.min(zs - P[:, 2])))

    # ---- sensors
    def radar_range(self) -> float:
        R = quat_to_dcm(self.q)
        P = self.p + R @ self.m.radar_pos
        c = R[2, 2]  # body down . world down
        if c < 0.5:
            return 60.0  # beyond the beam: out of range
        zs, _ = self.world.surface(P[0], P[1], self.t)
        return max(float(zs - P[2]) / c, 0.05)

    def skid_height(self) -> float:
        """Lowest skid point above the surface under the CG (m)."""
        R = quat_to_dcm(self.q)
        zs, _ = self.world.surface(self.p[0], self.p[1], self.t)
        return float(zs) - float(np.max((self.p + self.m.skid_pts @ R.T)[:, 2]))

    def json_state(self) -> dict:
        roll, pitch, yaw = euler(self.q)
        return {
            "timestamp": self.t,
            "imu": {"gyro": self.w.tolist(), "accel_body": self.accel_body.tolist()},
            "position": self.p.tolist(),
            "attitude": [roll, pitch, yaw],  # Euler, not a quaternion: SIM_JSON 4.7 maps rng_1 only then
            "velocity": self.v.tolist(),
            "rng_1": self.radar_range(),
            "battery": {"voltage": self.v_bus, "current": max(self.i_bus, 0.0)},
        }

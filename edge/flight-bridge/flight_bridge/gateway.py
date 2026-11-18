"""The gateway: MQTT commands in, MAVLink to the autopilot, telemetry and events out.

Flight safety stays on the autopilot: every command is a request that the gateway acks or refuses.
Threads: paho's network thread only queues payloads; all MAVLink I/O runs on the main loop thread.
"""

from __future__ import annotations

import json
import math
import queue
import re
import time

import paho.mqtt.client as mqtt
from ark_contracts import CommandType, DroneCommand, DroneEvent, Geo, ManualControl, Mission, Telemetry
from pymavlink import mavutil

from .ids import new_id
from .manual import SESSION_END_S, WATCHDOG_S, setpoint
from .mission import Item, reverse, to_items
from .telemetry import build_telemetry, utc_now

M = mavutil.mavlink
CMD_ID = re.compile(r"^cmd_[0-9A-HJKMNP-TV-Z]{26}$")
NEAR_M = 30.0  # "at the destination" / "back home" radius
HANDOVER_S = 10.0
INTERVALS_HZ = {
    M.MAVLINK_MSG_ID_GLOBAL_POSITION_INT: 5,
    M.MAVLINK_MSG_ID_ATTITUDE: 10,
    M.MAVLINK_MSG_ID_VFR_HUD: 5,
    M.MAVLINK_MSG_ID_SYS_STATUS: 1,
    M.MAVLINK_MSG_ID_BATTERY_STATUS: 1,
    M.MAVLINK_MSG_ID_VIBRATION: 1,
    M.MAVLINK_MSG_ID_HOME_POSITION: 1,
}


def parse_command(raw: bytes, drone_id: str) -> tuple[DroneCommand | None, dict]:
    """Validate a command payload. Returns (command, ack fields); command is None when it must be refused."""
    cmd_id = None
    try:
        cid = json.loads(raw).get("id")
        if isinstance(cid, str) and CMD_ID.match(cid):
            cmd_id = cid
    except (ValueError, AttributeError):
        pass

    def refuse(msg: str) -> tuple[None, dict]:
        return None, {"commandId": cmd_id, "accepted": False, "message": msg[:300]}

    try:
        cmd = DroneCommand.model_validate_json(raw)
    except ValueError as e:  # pydantic's ValidationError is a ValueError
        return refuse(str(e))
    if cmd.droneId.root != drone_id:
        return refuse(f"droneId {cmd.droneId.root} is not this drone ({drone_id})")
    if (cmd.type is CommandType.upload_mission) != (cmd.mission is not None):  # the schema's if/then, not generated
        return refuse("upload_mission needs a mission and no other command may carry one")
    return cmd, {"commandId": cmd.id.root, "accepted": True, "message": None}


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine, metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))


class Gateway:
    def __init__(self, broker: str, mav_url: str, drone_id: str):
        host, _, port = broker.partition(":")
        self.host, self.port = host, int(port or 1883)
        self.mav_url, self.drone_id = mav_url, drone_id
        self.topic = f"ark/{drone_id}/"
        self.mav = None
        self.q: queue.Queue[tuple[str, bytes]] = queue.Queue()
        self.proto: list = []  # mission-protocol replies, read by _upload
        self.state: dict = {}
        self.last_hb = 0.0
        self.last_boot_ms = 0
        self.need_intervals = False
        self.next_tel = 0.0
        self.prearm = ""
        self.last_batt = ""
        self.pont_ok: set[str] = set()
        self.armed, self.mode = False, ""
        self.home: Geo | None = None
        self.mission: Mission | None = None
        self.phase = "idle"  # idle -> uploaded -> outbound -> handover -> returning -> idle
        self.handover_at: float | None = None
        self.takeoff_pending = False
        self.manual_seq = -1
        self.manual_last = 0.0  # monotonic time of the last stick packet
        self.manual_on = False  # in a manual session (GUIDED velocity control)
        self.manual_holding = False
        self.manual_refused = False
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_message = lambda _c, _u, m: self.q.put((m.topic, m.payload))
        self._reset()

    # ---- main loop -------------------------------------------------------------------------------------------
    def run(self) -> None:
        self.client.connect_async(self.host, self.port)
        self.client.loop_start()
        self._connect_mav()
        while True:
            try:
                self._pump(0.05)
                while not self.q.empty():
                    topic, payload = self.q.get()
                    if topic.endswith("/manual"):
                        self.handle_manual(payload)
                    else:
                        self.handle_command(payload)
                self._manual_watchdog()
                if self.phase == "handover" and self.handover_at and time.monotonic() >= self.handover_at:
                    self._deliver()
            except OSError as e:  # the autopilot link dropped (SITL respawn, cable): reconnect, the reboot resets state
                print(f"mavlink link lost ({e}), reconnecting", flush=True)
                try:
                    self.mav.close()
                except (OSError, AttributeError):  # pymavlink's socket is already gone after a failed reconnect
                    pass
                time.sleep(1)
                self._connect_mav()

    def _on_connect(self, client, _userdata, _flags, reason_code, _properties) -> None:
        print(f"mqtt connected ({reason_code}), subscribing {self.topic}cmd", flush=True)
        client.subscribe(self.topic + "cmd", qos=1)  # here, so a reconnect resubscribes
        client.subscribe(self.topic + "manual", qos=0)  # a stick stream: latest wins, nothing to retry

    def _connect_mav(self) -> None:
        while True:
            try:
                self.mav = mavutil.mavlink_connection(
                    self.mav_url, source_system=1, source_component=191, autoreconnect=True
                )
                break
            except OSError as e:  # SITL may not be up yet
                print(f"mavlink {self.mav_url} not ready ({e}), retrying", flush=True)
                time.sleep(2)
        self.need_intervals = True
        print(f"mavlink connected {self.mav_url}", flush=True)

    def _pump(self, timeout: float) -> None:
        """Read MAVLink for up to `timeout`, then drain what is queued, then publish telemetry if due."""
        msg = self.mav.recv_match(blocking=True, timeout=timeout)
        while msg is not None:
            self._on_msg(msg)
            msg = self.mav.recv_match(blocking=False)
        self._telemetry()

    def _wait(self, cond, timeout: float) -> bool:
        end = time.monotonic() + timeout
        while not cond():
            if time.monotonic() > end:
                return False
            self._pump(0.05)
        return True

    # ---- MAVLink in ------------------------------------------------------------------------------------------
    def _on_msg(self, msg) -> None:
        k = msg.get_type()
        if k == "HEARTBEAT":
            if msg.type != M.MAV_TYPE_GCS:
                self._heartbeat(msg)
            return
        self.state[k] = msg
        if k == "GLOBAL_POSITION_INT":
            self._check_reboot(msg.time_boot_ms)
        if k == "GLOBAL_POSITION_INT" and self.takeoff_pending and msg.relative_alt > 2000:
            self.takeoff_pending = False
            self.emit("takeoff")
        elif k == "HOME_POSITION":
            self.home = Geo(lat=msg.latitude / 1e7, lon=msg.longitude / 1e7)
        elif k in ("MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"):
            self.proto.append(msg)
        elif k == "MISSION_ITEM_REACHED" and self.phase == "outbound":
            self.emit("waypoint_reached", waypointIndex=msg.seq)
        elif k == "STATUSTEXT":
            self._statustext(msg.text, msg.severity)

    def _check_reboot(self, boot_ms: int) -> None:
        """The autopilot's boot clock going backwards is a reboot (SITL respawn). Silence is not: a slow sim is quiet."""
        if boot_ms + 1000 < self.last_boot_ms:
            print("autopilot rebooted, mission state reset", flush=True)
            self._reset()
            self.need_intervals = True
        self.last_boot_ms = boot_ms

    def _heartbeat(self, msg) -> None:
        self.last_hb = time.monotonic()
        self.state["HEARTBEAT"] = msg
        mode = mavutil.mode_string_v10(msg)
        if mode != self.mode:
            print(f"mode {mode}", flush=True)
        self.mode = mode
        if self.need_intervals:
            self.need_intervals = False
            for msg_id, hz in INTERVALS_HZ.items():
                self.mav.mav.command_long_send(
                    self.mav.target_system, self.mav.target_component,
                    M.MAV_CMD_SET_MESSAGE_INTERVAL, 0, msg_id, int(1e6 / hz), 0, 0, 0, 0, 0,
                )  # fmt: skip
        was, self.armed = self.armed, bool(msg.base_mode & M.MAV_MODE_FLAG_SAFETY_ARMED)
        if was and not self.armed:
            self._on_disarm()

    def _statustext(self, text: str, severity: int) -> None:
        if "PreArm" in text:
            self.prearm = text
        if "FIRE at" in text:
            self.pont_ok.clear()
            self.state["pontoons"] = "inflating"
            self.emit("pontoons_fired", "warning", text)
        for side in "LR":
            if f"{side} pressure OK" in text:
                self.pont_ok.add(side)
        if self.pont_ok == {"L", "R"}:
            self.state["pontoons"] = "inflated"
        low = "battery failsafe" in text.lower() or ("Battery" in text and severity <= M.MAV_SEVERITY_WARNING)
        if low and text != self.last_batt:  # the autopilot repeats these
            self.last_batt = text
            self.emit("low_battery", "critical", text)

    # ---- state machine ---------------------------------------------------------------------------------------
    def _reset(self) -> None:
        self.state = {"pontoons": "stowed"}
        self.pont_ok.clear()
        self.home, self.armed = None, False
        self.takeoff_pending = False
        self._end()

    def _end(self) -> None:
        self._set_phase("idle")
        self.mission, self.handover_at = None, None

    def _set_phase(self, phase: str) -> None:
        if phase != getattr(self, "phase", None):
            print(f"phase {getattr(self, 'phase', None)} -> {phase}", flush=True)
        self.phase = phase

    def _near(self, g: Geo) -> bool:
        gp = self.state.get("GLOBAL_POSITION_INT")
        return gp is not None and distance_m(gp.lat / 1e7, gp.lon / 1e7, g.lat, g.lon) < NEAR_M

    def _on_disarm(self) -> None:
        if self.phase == "outbound":
            if self._near(self.mission.destination):
                self.emit("landed")
                self._set_phase("handover")
                self.handover_at = time.monotonic() + HANDOVER_S
                return
        elif self.phase == "manual":
            self.emit("landed", message="landed in manual control")
            self._end()
            return
        elif self.phase == "returning":
            if self.home and self._near(self.home):
                self.emit("landed", message="returned home")
                self._end()
                return
        else:
            return
        self.emit("landed", "warning", "landed away from target")
        self._end()

    def _deliver(self) -> None:
        self.handover_at = None
        # shortcut: fixed handover wait, the real flow waits for the recipient's PIN in the GDEX app.
        self.emit("payload_released")
        self.emit("delivered")
        err = None
        if not self._upload(reverse(self.mission, self.home)):
            err = "return leg upload failed"
        else:
            err = self._arm_and_start()
        if err:  # never take off blind: stay landed
            self.emit("fault", "warning", f"return leg not started: {err}")
            self._end()
        else:
            self._set_phase("returning")

    # ---- commands --------------------------------------------------------------------------------------------
    def handle_command(self, raw: bytes) -> None:
        cmd, ack = parse_command(raw, self.drone_id)
        if cmd is None:
            print(f"command refused: {ack['message']}", flush=True)
            self._ack(ack)
            return
        kind = cmd.type.value
        print(f"command {kind} {ack['commandId']}", flush=True)
        self._end_manual(f"ended by {kind}")
        handlers = {"upload_mission": self._upload_mission, "start": self._start}
        ok, msg = handlers.get(kind, self._set_flight_mode)(cmd)
        self._ack({"commandId": ack["commandId"], "accepted": ok, "message": msg})
        if not ok:
            return
        if kind == "start":
            self.emit("mission_started")
        elif kind == "rtl":
            self.emit("rtl")
        elif kind == "abort":
            self.emit("aborted", "warning", cmd.reason)

    def _ack(self, f: dict) -> None:
        print(f"ack {f['commandId']} accepted={f['accepted']} {f['message'] or ''}", flush=True)
        self.emit(
            "command_ack", "info" if f["accepted"] else "warning", f["message"],
            commandId=f["commandId"], accepted=f["accepted"],
        )  # fmt: skip

    def _upload_mission(self, cmd: DroneCommand) -> tuple[bool, str | None]:
        m = cmd.mission
        if self.armed:
            return False, "armed: cannot upload a mission"
        if self.phase not in ("idle", "uploaded"):
            return False, f"mission in progress ({self.phase})"
        if self.home is None:
            return False, "no home position yet"
        # shortcut: only ground landings in the GDEX build, water / winch / drop come with the relief flow.
        if m.landingType.value != "ground":
            return False, f"landingType {m.landingType.value} is not supported yet"
        if not self._upload(to_items(m, self.home)):
            return False, "autopilot did not accept the mission"
        self.mission = m
        self._set_phase("uploaded")
        return True, None

    def _start(self, _cmd: DroneCommand) -> tuple[bool, str | None]:
        if self.phase != "uploaded" or self.mission is None:
            return False, "no mission uploaded"
        if self.armed:
            return False, "already armed"
        err = self._arm_and_start()
        if err:
            return False, err
        self.takeoff_pending = True
        self._set_phase("outbound")
        return True, None

    def _set_flight_mode(self, cmd: DroneCommand) -> tuple[bool, str | None]:
        mode = {"hold": "GUIDED", "rtl": "RTL", "land": "LAND", "abort": "RTL"}[cmd.type.value]
        if not self._set_mode(mode):  # GUIDED holds position and height on entry
            return False, f"autopilot did not confirm {mode}"
        if mode == "RTL" and self.phase == "outbound":
            self._set_phase("returning")
        return True, None

    def _set_mode(self, mode: str) -> bool:
        mapping = self.mav.mode_mapping() or {}
        if mode not in mapping:
            return False
        self.mav.set_mode(mapping[mode])
        return self._wait(lambda: self.mode == mode, 5)

    def _arm_and_start(self) -> str | None:
        """AUTO, arm (retry 1 s, 30 s), MISSION_START. Returns an error message, or None on success."""
        if not self._set_mode("AUTO"):
            return "autopilot did not confirm AUTO"
        self.prearm = ""
        end = time.monotonic() + 30
        while not self.armed:
            if time.monotonic() > end:
                return self.prearm or "arming failed"
            self.mav.arducopter_arm()
            self._wait(lambda: self.armed, 1)
        self.mav.mav.command_long_send(
            self.mav.target_system, self.mav.target_component, M.MAV_CMD_MISSION_START, 0, 0, 0, 0, 0, 0, 0, 0
        )
        return None

    def _upload(self, items: list[Item]) -> bool:
        """Standard mission protocol: count, answer each request with an item, wait for the ack. 3 tries of 2 s."""
        tgt = (self.mav.target_system, self.mav.target_component)
        for _ in range(3):
            self.proto.clear()
            self.mav.mav.mission_count_send(*tgt, len(items), 0)
            end = time.monotonic() + 2
            while time.monotonic() < end:
                self._pump(0.05)
                while self.proto:
                    m = self.proto.pop(0)
                    if m.get_type() == "MISSION_ACK":
                        return m.type == M.MAV_MISSION_ACCEPTED
                    if 0 <= m.seq < len(items):
                        it = items[m.seq]
                        self.mav.mav.mission_item_int_send(
                            *tgt, it.seq, it.frame, it.command, it.current, it.autocontinue,
                            it.p1, it.p2, it.p3, it.p4, it.x_lat_e7, it.y_lon_e7, it.z, 0,
                        )  # fmt: skip
                        end = time.monotonic() + 2
        return False

    # ---- manual control (stick stream) ----------------------------------------------------------------------------
    def handle_manual(self, raw: bytes) -> None:
        """One stick packet. Not acked: stale, foreign or grounded packets are dropped."""
        try:
            m = ManualControl.model_validate_json(raw)
        except ValueError:
            return
        if m.droneId.root != self.drone_id:
            return
        now = time.monotonic()
        if m.seq <= self.manual_seq and now - self.manual_last < SESSION_END_S:  # reordered or stale
            return
        gp = self.state.get("GLOBAL_POSITION_INT")
        if not self.armed or gp is None or gp.relative_alt < 2000:
            if not self.manual_refused:  # say it once per attempt, not 10 times a second
                self.manual_refused = True
                self.emit("manual_ended", "warning", "manual control needs the drone armed and airborne")
            return
        self.manual_seq, self.manual_last = m.seq, now
        if not self.manual_on:
            if not self._set_mode("GUIDED"):
                return
            self.manual_on, self.manual_refused = True, False
            if self.phase in ("outbound", "returning", "uploaded"):
                self._set_phase("manual")
            self.emit("manual_started", "warning", f"operator {m.issuedBy or 'unknown'} has the sticks")
        self.manual_holding = False
        self._velocity(*setpoint(m))

    def _velocity(self, fwd: float, right: float, down: float, yaw_rate: float) -> None:
        """GUIDED velocity + yaw-rate setpoint in the heading-aligned body frame."""
        mask = 0b0000_0101_1100_0111  # use velocity and yaw rate; ignore position, acceleration and yaw angle
        self.mav.mav.set_position_target_local_ned_send(
            0, self.mav.target_system, self.mav.target_component, M.MAV_FRAME_BODY_OFFSET_NED,
            mask, 0, 0, 0, fwd, right, down, 0, 0, 0, 0, yaw_rate,
        )  # fmt: skip

    def _manual_watchdog(self) -> None:
        if not self.manual_on:
            return
        quiet = time.monotonic() - self.manual_last
        if quiet > WATCHDOG_S and not self.manual_holding:  # the operator's link went quiet: stop and hold
            self.manual_holding = True
            self._velocity(0, 0, 0, 0)
        if quiet > SESSION_END_S:
            self._end_manual("no stick input for 5 s, holding position")

    def _end_manual(self, why: str) -> None:
        self.manual_refused = False
        if not self.manual_on:
            return
        self.manual_on = False
        if self.phase == "manual":
            self._set_phase("idle")
        self.emit("manual_ended", message=why)

    # ---- MQTT out --------------------------------------------------------------------------------------------
    def _telemetry(self) -> None:
        now = time.monotonic()
        if now < self.next_tel:
            return
        self.next_tel = now + 0.2  # 5 Hz
        if "GLOBAL_POSITION_INT" not in self.state or now - self.last_hb > 15:  # no stale telemetry (slow sims stay)
            return
        try:
            t = Telemetry.model_validate(
                build_telemetry(self.state, self.drone_id, self.mission.id.root if self.mission else None)
            )
        except ValueError as e:
            print(f"telemetry skipped: {str(e)[:200]}", flush=True)
            return
        body = t.model_dump(mode="json", exclude_none=True, by_alias=True)
        self.client.publish(self.topic + "telemetry", json.dumps(body), qos=0)

    def emit(self, type: str, severity: str = "info", message: str | None = None, **fields) -> None:
        gp = self.state.get("GLOBAL_POSITION_INT")
        ev = {"id": new_id("evt"), "droneId": self.drone_id, "ts": utc_now(), "type": type, "severity": severity}
        ev |= fields
        if self.mission:
            ev["missionId"] = self.mission.id.root
        if gp:
            ev["position"] = {"lat": gp.lat / 1e7, "lon": gp.lon / 1e7, "altM": gp.relative_alt / 1000}
        if message:
            ev["message"] = message[:500]
        try:
            e = DroneEvent.model_validate(ev)
        except ValueError as err:
            print(f"event {type} dropped: {str(err)[:200]}", flush=True)
            return
        print(f"event {type} {severity} {message or ''}", flush=True)
        self.client.publish(
            self.topic + "events", json.dumps(e.model_dump(mode="json", exclude_none=True, by_alias=True)), qos=1
        )

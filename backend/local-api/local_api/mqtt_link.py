"""MQTT side of the local SOS API: publishes each SOS on `sos/<sosId>` and follows missions on `fleet/live`."""

import json
from typing import Protocol

from .store import CLOSED, SosStore


class Publisher(Protocol):
    def publish(self, sos: dict) -> None: ...


class NoPublisher:
    """Runs the API without a broker (`--broker ""`)."""

    def publish(self, sos: dict) -> None:
        return None


class MqttPublisher:
    """Retained QoS 1 on `sos/<sosId>`, so an Ark Command tab opened later still sees open calls."""

    def __init__(self, broker: str, store: SosStore) -> None:
        import paho.mqtt.client as mqtt

        self._store = store
        host, _, port = broker.rpartition(":")
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message
        self._client.connect(host, int(port))
        self._client.loop_start()

    def publish(self, sos: dict) -> None:
        self._client.publish(f"sos/{sos['id']}", json.dumps(sos), qos=1, retain=True)

    def _on_connect(self, client, _userdata, _flags, _reason, _props) -> None:
        client.subscribe("fleet/live", qos=1)

    def _on_message(self, _client, _userdata, msg) -> None:
        for sos in apply_live_message(self._store, msg.payload):
            self.publish(sos)
            if sos["status"] in CLOSED:
                self.publish(sos)  # once more so the retained copy is the final state even if the first was dropped


def apply_live_message(store: SosStore, payload: bytes | str) -> list[dict]:
    """A `fleet/live` message: for a mission with sosRequestIds, update those SOS. Bad messages are ignored."""
    try:
        msg = json.loads(payload)
        if not isinstance(msg, dict) or msg.get("kind") != "mission":
            return []
        mission = msg.get("data")
        if not isinstance(mission, dict) or not mission.get("sosRequestIds"):
            return []
        return store.apply_mission(mission)
    except (ValueError, KeyError, TypeError):
        return []

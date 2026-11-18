# flight-bridge

Ark-1's companion-computer process: it bridges the cloud (MQTT) and the autopilot (MAVLink).

- Publishes `ark/<id>/telemetry` (5 Hz, QoS 0) and `ark/<id>/events` (QoS 1), validated against the generated
  contract models.
- Takes `ark/<id>/cmd` (`upload_mission`, `start`, `hold`, `rtl`, `land`, `abort`) and answers each with exactly
  one `command_ack` event. Flight safety stays on the autopilot: commands are requests the gateway may refuse.
- Runs the delivery flow `idle → uploaded → outbound → handover → returning → idle`: lands at the destination,
  waits for the handover, then flies the return leg itself.

Python, because the MAVLink tooling (pymavlink) and the generated Pydantic contracts are Python.

## Run
In development it runs in Docker next to the ArduCopter SITL, with Mosquitto as the broker (see `compose.yaml` at the
repo root):

    docker compose up

Directly: `python -m flight_bridge --broker broker:1883 --mav tcp:sim:5760 --drone ARK-006`

## Test
No SITL or broker needed:

    pip install -r requirements.txt
    ruff check . && ruff format --check . && pytest

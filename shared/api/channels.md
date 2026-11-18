# Channels: MQTT, internal events, WebSocket

Everything asynchronous in Noah's Ark. REST is in [openapi.yaml](openapi.yaml). Every payload is a schema in
[../schemas/](../schemas/).

## Drone ↔ cloud (AWS IoT Core, MQTT)
| Topic | Direction | QoS | Schema | Publisher | Subscribers |
|---|---|---|---|---|---|
| `ark/<droneId>/telemetry` | drone → cloud | 0 | `telemetry` | `edge/flight-bridge` (or the SITL bridge) | IoT rule → `telemetry-ingest` → Timestream + WebSocket |
| `ark/<droneId>/events` | drone → cloud | 1 | `drone-event` | `edge/flight-bridge`, `edge/offload-manager` | IoT rule → EventBridge (`drone.event`) |
| `ark/<droneId>/cmd` | cloud → drone | 1 | `drone-command` | `dispatch-agent`, the approve and abort handlers | `edge/flight-bridge` |

Simulation only (never on a real drone):
| Topic | Direction | QoS | Payload | Publisher | Subscribers |
|---|---|---|---|---|---|
| `sim/<droneId>/spawn` | app → sim | 1 | `{"lat": n, "lon": n}` | Ark Command (sim mode) | `simulation/ark_sim/live.py`: reboots SITL there on real terrain and current wind |
| `fleet/live` | fleet sim → app | 1 | `live-update` (`kind` `drone` or `mission` only) | `simulation/ark_fleet` | Ark Command Fleet page. Stands in for the WebSocket feed |
| `fleet/stats` | fleet sim → app | 1, retained | `{"flying", "queued", "deliveredTotal", "avgDeliveryMin", "onTimePct", "promiseMin", "windMs", "windFromDeg", "speedup"}` | `simulation/ark_fleet` | Ark Command Fleet page |
| `fleet/weather` | fleet sim → app | 1, retained | `weather` | `simulation/ark_fleet` (Open-Meteo per hub + a demo storm cell) | Ark Command Fleet page, dispatch (in-process) |
| `sim/<droneId>/status` | sim → app | 1, retained | `{"state": "booting" \| "ready" \| "error", "lat", "lon", "groundAmslM", "windMs", "windFromDeg", "detail"?}` | `live.py` | Ark Command |

Locally the broker is Mosquitto (`compose.yaml`, MQTT 1883, WebSocket on host port 9101) with the same topics and payloads as IoT Core.

Rules:
- **Manual control is a stick stream, not a command.** It is not acked. The drone clamps it, switches to GUIDED
  velocity control while airborne, and holds position if no packet arrives for 1 s. It is ignored on the ground.
- **The drone is the authority on flight.** Every command gets a `command_ack` event (`accepted: true|false`).
  The drone may refuse a command, for example `start` with a low battery. After losing the link it finishes or aborts
  the mission on its own.
- **Events are queued onboard** while the link is down and sent in order on reconnect, so `ts` is when the event
  happened, not when it arrived. Telemetry is not queued; only the latest value matters.
- `<droneId>` in the topic must match `droneId` in the payload. The IoT policy limits each drone's certificate to its
  own topics.
- On LoRa or satellite, telemetry drops to every 10 to 30 s. The schema stays the same.

## Internal events (Amazon EventBridge, bus `noah-ark-<env>-bus`)
`source` is `noah-ark.<component>`, `detail-type` is the name below, and `detail` is the schema object.

| detail-type | Detail schema | Emitted by | Consumed by |
|---|---|---|---|
| `sos.created` | `sos-request` | POST /sos handler, SMS / WhatsApp intake | Step Functions `sos-flow` (starts triage) |
| `sos.triaged` | `sos-request` | `sos-triage` | `sos-flow` (plan if urgency ≥ 3, else queue for the operator), WebSocket |
| `mission.planned` | `mission` | `mission-planner` | WebSocket (Ark Command approval queue) |
| `mission.status_changed` | `mission` | approve / abort handlers, `dispatch-agent`, the event handler | WebSocket, `report-writer` (on `delivered`, `returned`, `aborted`) |
| `drone.event` | `drone-event` | IoT rule on `ark/+/events` | `dispatch-agent` (acks, progress), WebSocket, `maintenance-assistant` (`fault`, `pontoon_failure`) |

The SOS flow: `sos.created` → `sos-triage` → `mission-planner` → `pending_approval` → operator approves → `dispatch-agent` sends
`upload_mission` then `start` → the drone's events move the mission to `in_flight` and then `delivered`.

## Server → dashboard (API Gateway WebSocket)
One message per change, schema `live-update`: `{ "kind": "telemetry" | "drone_event" | "sos" | "mission" | "drone", "data": {...} }`.
Ark Command and Ark Care connect with the Cognito JWT as the `token` query parameter. Dashboards send nothing on the socket;
actions go through REST.

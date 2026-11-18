# Shared contracts

The one definition of every message between Ark SOS, Ark Brain, Ark Command, Ark Care and the drone. Change a schema
here first, run codegen, then update the consumers.

| Path | What |
|---|---|
| `schemas/*.schema.json` | JSON Schema 2020-12. The source of truth |
| `api/openapi.yaml` | REST API (OpenAPI 3.1). Bodies `$ref` the schemas |
| `api/channels.md` | MQTT topics, EventBridge events and the WebSocket feed |
| `examples/<contract>/valid-*.json`, `invalid-*.json` | Example payloads. Tests check each passes or fails as named |
| `generated/` | Types made by `scripts/codegen.py`. Never edit by hand |

## The contracts
| Schema | Where it travels |
|---|---|
| `sos-request` (`report`, `triage`, `delivery`, `locationUpdate` in `$defs`) | POST /sos body (`report`), stored SOS, `sos-triage`'s Bedrock output (`triage`), the drone on its way and its kit for the sender (`delivery`), POST /sos/{id}/location body (`locationUpdate`), PUT /sos/{id}/report body (`report`) |
| `mission` (`request` in `$defs`) | POST /missions body (`request`), `mission-planner` output, the operator's approval queue |
| `telemetry` | `ark/<droneId>/telemetry` |
| `drone-command` | `ark/<droneId>/cmd`. The drone acks every command and may refuse it |
| `drone-event` | `ark/<droneId>/events` |
| `drone` | the fleet registry, GET /drones |
| `live-update` | the WebSocket feed to the dashboards |
| `common` | location, IDs (`ARK-NNN`, `sos_`/`msn_`/`cmd_`/`evt_` + ULID), `mode`, timestamps |

Some rules a schema cannot hold are checked in code. For example, a mission's `payloadKg` must equal the sum of its
`payload` weights.

## Generated types
```bash
pip install -r requirements.txt
python scripts/codegen.py
```
| Language | Output | Use from |
|---|---|---|
| TypeScript | `generated/typescript/contracts.ts` | the React apps, TS Lambdas, CDK |
| Python (Pydantic v2) | `generated/python/ark_contracts/` | the Python Lambdas, `edge/`, `simulation/` |
| Dart | `generated/dart/lib/ark_contracts.dart` (SOS types only), a path package (`ark_contracts`) | `apps/sos-mobile` |

Generated types carry the shape only. Rules such as "`upload_mission` needs a `mission`" or "an ack needs `accepted`"
live in the schemas, so validate untrusted input against the schema with ajv or jsonschema, not just the types.

## Test
```bash
ruff check . && ruff format --check . && pytest
```
The tests check four things:
- every schema is valid 2020-12
- every example passes or fails as its name says
- the generated Pydantic models parse every valid example
- every OpenAPI `$ref` resolves, and the 2 kg payload cap matches `hardware/ark.json`

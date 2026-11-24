# local-api

Local only. In AWS this is API Gateway + Lambdas + Step Functions; here one process so the demo runs offline. Python
because it calls the Python triage (`backend/functions/sos-triage`).

## What it does
- `POST /v1/sos` validates the report, stores it, triages it (Bedrock if configured, else keyword rules), publishes it.
- `GET /v1/sos/{id}`, `PUT /v1/sos/{id}/report` (re-triages), `POST /v1/sos/{id}/location` (204), `GET /v1/health`.
  `PUT` and location return 409 once the SOS is delivered or closed. CORS is open (`*`).
- Every create or change is published retained on MQTT `sos/<sosId>` (`sos-request` schema), so Ark Command's Fleet
  page shows open calls, even in a tab opened later.
- It subscribes to `fleet/live`: a `mission` with `sosRequestIds` marks those SOS `assigned` (with `delivery`) and then
  `delivered`, and publishes each change.

## Run
```bash
pip install -r requirements.txt
python -m local_api --broker localhost:1883 --port 8080   # --broker "" runs without MQTT
```
Or `docker compose up broker fleet sos-api` from the repo root. Set `BEDROCK_MODEL_ID` and `AWS_REGION` to use Bedrock
for triage.

## Test
```bash
ruff check . && ruff format --check . && pytest
```
Tests use a fake publisher, so no broker is needed.

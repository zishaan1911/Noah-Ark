# dispatch-agent

Fleet dispatch optimiser. Given open orders, the fleet and the wind, it picks which Ark-1 flies each order: the fastest
eligible drone, with the battery reserve respected. Each pick comes with a plain-English rationale, optionally rewritten
by Bedrock.

**Why Python:** it is the AI-heavy side of Ark Brain (Bedrock), and the fleet simulator imports `optimiser.py` directly.

## Run the tests

```
cd backend/functions/dispatch-agent
pip install -r requirements.txt
ruff check . && ruff format --check . && pytest
```

## Event shape

```json
{
  "orders": [{ "id": "ord_17", "mode": "gdex", "destLat": 5.98, "destLon": 116.07, "payloadKg": 1.2, "urgency": 2, "createdS": 0 }],
  "drones": [{ "id": "ARK-104", "lat": 5.95, "lon": 116.05, "homeLat": 5.95, "homeLon": 116.05,
               "status": "available", "batteryPct": 88, "maxPayloadKg": 2 }],
  "wind": { "ms": 3.0, "fromDeg": 270 },
  "nowS": 600
}
```

Returns `{"assignments": [{"orderId", "droneId", "etaMin", "batteryAfterPct", "runnerUp", "aiRationale"}]}`.
Missing or wrong-typed fields raise `ValueError`. `aiRationale` is the template text unless `BEDROCK_MODEL_ID` is set
(region from `AWS_REGION`, default `ap-southeast-1`; prompt in `prompts/dispatch-rationale.v1.md`).

## Energy model assumptions

Numbers from `hardware/ark.json`: 17 m/s cruise, 886.6 W loaded (2 kg) and 690.4 W empty, hover 1076.1 W loaded and
829.8 W empty, 864 Wh pack, 20% battery reserve on landing, 60 s hover per leg, 30 s delivery hover, 20 km max one way.
Power is interpolated linearly by payload. Ground speed is airspeed plus the along-track wind (minimum 3 m/s). A trip is
drone to destination loaded, delivery hover, then destination to home empty.

Eligible drones are `available`, can carry the payload, are within 20 km, and land with at least 20%.

shortcut: dispatch uses a greedy per-order pick, upgrade to a joint assignment / VRP solver when the fleet passes ~50 drones.

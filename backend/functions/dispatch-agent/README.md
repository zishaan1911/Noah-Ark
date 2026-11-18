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

## Weather

Optional `"weather"` in the event, shaped like `shared/schemas/weather.schema.json` (`hubs[]` with lat/lon/call/reason,
`storms[]` with id/lat/lon/radiusKm/rainMmH). Each assignment then carries `"route": [{"lat","lon"}, ...]` (empty when
straight). Without `weather` nothing changes.

| Limit (Ark-1 estimates) | Caution | No-go |
|---|---|---|
| Wind | 8 m/s | 12 m/s |
| Gusts | 11 m/s | 15 m/s |
| Rain | 10 mm/h | 30 mm/h |
| Thunderstorm (WMO 95-99) | | always |

`weather.fly_call()` makes the call. A `no_go` hub launches nothing. A `caution` hub caps the one-way range at 15 km
(instead of 20). Storms are circles: a leg that passes within radius + 1 km of a centre is bent round it with one
waypoint, and the rationale says how many km that adds. A drop inside a storm cannot be served (`held_reason()` says why).

shortcut: flat-earth detour, fine under ~50 km, use geodesic maths beyond that.
shortcut: one detour waypoint per storm (recursion depth 3), use a visibility-graph planner for dense storm fields.
shortcut: storms are static during a pick, re-run dispatch as they move.

shortcut: dispatch uses a greedy per-order pick, upgrade to a joint assignment / VRP solver when the fleet passes ~50 drones.

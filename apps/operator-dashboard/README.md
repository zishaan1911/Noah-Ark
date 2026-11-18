# Ark Command (operator dashboard)

React + Vite + TypeScript + Tailwind v4. The GDEX operator's screen: pick a start and a destination on a light,
Apple Maps-like street map, plan a terrain-following route for Ark-1, send it to ARK-006, then watch the flight live in three views
(Map, Chase, Onboard). One MapLibre map is shared by all three views.

## Run
1. At the repo root, `docker compose up` (Mosquitto on MQTT 1883 and WebSocket on host port 9101). The simulation
   (`simulation/ark_sim/live.py`) must be running to answer `sim/ARK-006/spawn`.
2. `cp .env.example .env` (keys: `VITE_MQTT_URL`, `VITE_DRONE_ID`).
3. `npm install`, then `npm run dev`.

The 3D drone in Chase view is `public/models/ark1.glb` (metres, +Y up, nose toward -Z, props `prop_1`..`prop_4`).
If it is missing the view still works and shows a "3D model not loaded" chip.

## Test
`npm run lint && npm test && npm run build`

Tests cover route planning (`planRoute.test.ts`), the shared JSON schemas through ajv (`validate.test.ts`), ids and
geo maths. Types come from `shared/generated/typescript/contracts.ts` through the `@contracts` alias; schemas are
loaded from `shared/schemas` through `@schemas`.

## How it works
- `lib/planRoute.ts`: haversine distance (rejects over 20 km), ground sampled every 100 m with an 80 m corridor,
  legs of at most 1 km, each waypoint at the highest ground in its leg and the next 300 m plus 60 m clearance, never
  below 30 m. Straight-line planning in the browser is a `shortcut:`; it moves to the `mission-planner` Lambda.
- `lib/flightOps.ts`: spawn the sim at the start if needed, `upload_mission`, `start`; each command is validated
  with ajv and waits for its `command_ack`.
- `hooks/useDrone.ts`: telemetry, events and sim status over MQTT, each validated before use.
- `hooks/useInterpolatedPose.ts`: 5 Hz telemetry smoothed per frame for the cameras.

## Data sources and attribution
- Base map: OpenFreeMap vector tiles (style `liberty`, tinted in `src/lib/mapStyle.ts`), no API key. "OpenFreeMap
  © OpenMapTiles, data from OpenStreetMap" (shown in the map's attribution control).
- Elevation: AWS Terrain Tiles (terrarium, z12) from the Registry of Open Data on AWS. Sources include SRTM, ASTER
  GDEM and others; see the Terrain Tiles attribution page.
- Map engine: MapLibre GL JS. 3D: three.js. Messaging: mqtt.js.

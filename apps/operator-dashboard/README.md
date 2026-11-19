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

## Use
- **Pick:** search a place, click the map while picking, right-click or long-press to set the destination, or drag
  the pins.
- **Deliver:** the card steps through Plan → Review → Sending → Flying → Delivered. The bottom sheet (drag it: peek,
  half, full) holds live telemetry, flight controls and events.
- **Views:**
  - **Chase:** drag to orbit, wheel or pinch to zoom, double-click to reset.
  - **Onboard:** drag to aim the gimbal, wheel to zoom the field of view.
  - Both hide the planning UI and show a minimap.
- **Fly manually** (bottom sheet, once airborne):
  - W/S forward and back, A/D sideways, Q/E or ←/→ to yaw, R/F to climb and descend, Shift to boost, Space to stop.
  - Sticks stream on `ark/ARK-006/manual` at 10 Hz. The drone holds position if they stop for 1 s.
  - End manual offers Hold, Return home or Land.
- **Theme:** the sun/moon button in the header switches light and dark.

## Fleet view
Open `#/fleet` (or the **Drone | Fleet** switch in the header) to see the 24-drone fleet (ARK-101..124) at 6 hubs:
drones on a flat map, active missions as dashed lines (blue GDEX, red relief), KPIs, and the dispatcher feed with the
AI's reason for each pick. Needs the fleet simulator (`docker compose up fleet`). It reads `ark/+/telemetry`,
`fleet/live` and `fleet/stats`; state is batched and shown every 500 ms (`hooks/useFleet.ts`, `lib/fleet.ts`).

## Defence terminal
`#/defence` (or **Defence** in the page switch) is military resupply in a green-on-black console, on the same live
simulated flight (ARK-006). The sector is Darvel Bay around Lahad Datu, eastern Sabah. The outposts and threat zones
are exercise data in `src/lib/defence.ts`, and every request's route bends around the no-fly zones with at least 1 km
to spare (tested).
- **Queue:** pick a request. REQ-0415 is held because its drop is inside a threat zone.
- **Plan route:** each leg of the bent route is terrain-followed and the legs are joined. The go / no-go list checks
  payload, range, threat-zone clearance, the sim's wind, the broker link and a second operator.
- **Authorise launch** needs the second-operator box. It respawns the sim at the main base, uploads a `military`
  mission and starts it. The drone flies home along the same bent route.
- **Live telemetry:** altitude, speed, heading, climb, pack and bus voltage, an attitude indicator, mode, pontoons,
  motor temperatures, vibration and link. It reads stale after 5 s without data.
- **Commands:** hold, return to base and land, while airborne. The log at the bottom shows the drone's events and the
  terminal's own entries.

The live flight is the Ark-1 SITL airframe, so requests stay under its 2 kg. Ark-1M (4 kg) is the design in
`hardware/ark-1m/`. A headless browser that renders the map in software can starve the sim of CPU; a normal
browser with a GPU does not.

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

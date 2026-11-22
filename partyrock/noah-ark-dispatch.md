# noah-ark-dispatch (flagship pitch app)

**PartyRock app:** "Noah's Ark: SOS & Delivery Drone" on khoryz666's PartyRock (public, plus a snapshot).
_TODO: paste the public share link here._

**Problem:** people die in floods, and parcels are hard to deliver through dense forest.
**Solution:** an SOS app that calls a purpose-built amphibious drone. While no one needs help, the same drone
delivers parcels.

One app tells the whole story, and every rule in it comes from this repo, not from the model's general knowledge:
an SOS (any language) or a parcel order goes through triage, a weather go/no-go, dispatch over the real 24-drone
Sabah fleet, the 2 kg kit, a reply to the sender, and a mission in the backend's own schema.

| Widget | From the repo |
|---|---|
| Can Ark fly? | Limits in `backend/functions/dispatch-agent/weather.py` |
| Dispatch | Hubs, drop points and drone ids from `simulation/ark_fleet/network.py`; grounding from `backend/functions/health-monitor`; landing evidence from `hardware/ark.json` → `simulation.result` |
| Drone kit | Rules from `backend/functions/mission-planner/prompts/kit.v1.md` |
| Mission for Ark Brain | `shared/schemas/mission.schema.json` |
| Ask Ark | `hardware/ark.json` and `hardware/README.md` facts, the four SITL scenarios |

Keep these in sync: if a limit, the fleet or the schema changes in the repo, change the prompt here and in PartyRock.

## Builder notes (PartyRock, Nov 2026)
- Widget titles may not contain `[ ] ( ) { } ' " \ < >`. A title with one of them silently fails to save, and so
  do the other fields edited with it.
- `@` references: type `@` plus the start of the title and pick from the list. A space ends the search, so type
  `@Can`, not `@Can Ark`.
- A public app keeps edits as a draft until **Release changes** is clicked.
- Sliders: Numeric type, min 0. The value is set in the app, not in the widget settings.
- Fast typing into the Static Text box drops characters. Paste the content in one go and read it back.

## Widgets (top to bottom)
| # | Type | Title | Settings |
|---|---|---|---|
| 1 | Text Input | Message | hint `Type an SOS in any language, or a parcel order`; pre-filled with demo 1 |
| 2 | Text Input | Where | hint `Village or place in Sabah, e.g. Kampung Tempasuk, Kota Belud`; pre-filled `Kampung Tempasuk, Kota Belud, Sabah` |
| 3 | File Upload | Photo | optional; `Optional: a photo of where you are (flood water, roof, clearing)` |
| 4 | Slider | Wind m/s | numeric 0-20, step 1 |
| 5 | Slider | Gusts m/s | numeric 0-25, step 1 |
| 6 | Slider | Rain mm/h | numeric 0-60, step 5 |
| 7 | AI Output | Triage | Claude Sonnet 5.5 |
| 8 | AI Output | Can Ark fly? | Claude Sonnet 5.5 |
| 9 | AI Output | Dispatch | Claude Sonnet 5.5 |
| 10 | AI Output | Drone kit | Claude Sonnet 5.5 |
| 11 | AI Output | Reply to sender | Claude Sonnet 5.5 |
| 12 | Image Output | Drone on the way | default |
| 13 | AI Output | Mission for Ark Brain | Claude Sonnet 5.5 |
| 14 | Chat Box | Ask Ark | Claude Sonnet 5.5 |
| 15 | Static Text | Built on our repo | markdown |

### 7. Triage
```
Message: @Message
Place: @Where
You are the triage officer for Noah's Ark, a fleet of amphibious delivery drones in Malaysia.
Read the message and the place above.

Decide the mode:
- relief: someone needs help (flood, injury, stranded, no food or water, medicine).
- gdex: an ordinary parcel order to a remote village.
- military: a resupply order from a unit.

Answer in exactly this format, no other text:
Mode: relief | gdex | military
Urgency: 1-5 (5 = someone may die without help; parcels are 1)
Language: the language the message was written in
People: number, and how many are children, elderly, disabled or pregnant (write "unknown" if not said)
Needs: comma-separated from food, water, medicine, baby_supplies, shelter, rescue, parcel, other
Medicines asked for: list, or none
Summary: one sentence in English for the operator

Photo: if a photo is attached, add one last line: Photo: how deep the water looks and where a drone could land (on water, on a roof, on dry ground). If there is no photo, write Photo: none.
Photo (may be empty): @Photo
```

### 8. Can Ark fly?
```
Wind: @Wind m/s
Gusts: @Gusts m/s
Rain: @Rain mm/h
You make the weather call for an Ark-1 drone, with the same limits as the Ark Brain dispatch Lambda (dispatch-agent/weather.py). They are design estimates from the airframe (17 m/s cruise, sealed shell), not flight-tested numbers.
- NO-GO if wind is 12 m/s or more, gusts 15 m/s or more, or rain 30 mm/h or more.
- CAUTION if wind is 8 m/s or more, gusts 11 m/s or more, or rain 10 mm/h or more. Caution cuts the range to 15 km one way.
- Otherwise GO, with the full 20 km one way.
If several limits are hit, name the one furthest over its limit (value divided by limit).

Answer in exactly this format, no other text:
Call: GO | CAUTION | NO-GO
Reason: the limit hit, e.g. Wind 13 m/s (limit 12), or all within limits
Max one-way range: 20 km | 15 km | 0 km
Note: one short sentence for the operator
```

### 9. Dispatch
Distances are great-circle km from each drop point to its hub, computed from `simulation/ark_fleet/network.py`.
The fleet state is a fixed demo scene: Kota Belud has no idle drone (so an SOS there pre-empts a parcel run) and one
drone grounded by health-monitor; Ranau has idle drones for the parcel demo.
```
Place: @Where
Triage: @Triage
Weather call: @Can Ark fly?
You are the Noah's Ark dispatcher for Sabah. This is the live fleet from the Ark fleet simulation (ark_fleet): 24 Ark-1 drones, 4 at each of 6 hubs.

Hubs (lat, lon): Kota Kinabalu 5.980, 116.074 | Papar 5.735, 115.930 | Beaufort 5.347, 115.746 | Keningau 5.338, 116.160 | Kota Belud 6.351, 116.431 | Ranau 5.954, 116.664

Drop points, with their distance from their hub:
Kota Kinabalu: Tanjung Aru 5 km, Putatan 11 km, Penampang 8 km, Inanam 7 km, Menggatal 12 km, Kampung Kinarut 11 km (water)
Papar: Kampung Benoni 7 km, Limbahau 9 km, Kawang 11 km, Kampung Pengalat Besar 4 km (water), Kampung Kelanahan 4 km, Kampung Langkuas 5 km (water)
Beaufort: Kampung Gadong 9 km, Lumadan 11 km, Kampung Padas Damit 5 km (water), Weston 14 km (water), Kampung Kebatu 12 km, Kampung Mawao 9 km
Keningau: Bingkor 11 km, Apin-Apin 7 km, Kampung Liawan 8 km, Tulid 6 km, Pandewan 11 km, Kampung Mamaitom 9 km
Kota Belud: Kampung Taun Gusi 9 km, Kampung Pandasan 7 km, Kampung Tempasuk 13 km (water), Kadamaian 14 km, Kampung Taginambur 6 km, Kampung Sembirai 6 km
Ranau: Kundasang 11 km, Poring 10 km, Kampung Nalapak 6 km, Kampung Luanti 6 km, Bundu Tuhan 11 km, Kampung Marakau 8 km
For a place not listed, estimate its distance to the nearest hub (one degree is about 111 km). Places outside Sabah are out of range.

Drones now:
- Kota Belud: ARK-117 at the hub, loaded and about to leave on a GDEX run to Kampung Sembirai, battery 90 %. ARK-118 GROUNDED by health-monitor (predictive-maintenance model: motor 3 bearing wear, about 5 h of life left). ARK-119 flying a GDEX run to Kadamaian, battery 60 %. ARK-120 pack swap, battery 20 %.
- Ranau: ARK-121 idle, 100 %. ARK-122 idle, 95 %. ARK-123 flying a GDEX run to Poring, 70 %. ARK-124 charging, 40 %.
- Kota Kinabalu: ARK-101 idle, 100 %. ARK-102 to ARK-104 flying GDEX runs.
- Papar, Beaufort, Keningau (ARK-105 to ARK-116): all flying GDEX runs or charging.

Each Ark-1 carries 2 kg and cruises at 17 m/s (61 km/h).
Rules:
1. Weather first. If the call is NO-GO, send no drone: hold the mission, re-check every 10 minutes, and alert the Bomba / APM rescue team if the triage says relief with urgency 4 or 5.
2. The drop must be within the max one-way range from the weather call (20 km, or 15 km on CAUTION).
3. Life first. An SOS with urgency 4 or 5 takes a drone from the nearest hub in range, even one loaded for a parcel run: swap its pod for the relief kit and re-queue the parcel.
4. Urgency 3 or less, and parcel orders, take an idle drone; parcel runs are not interrupted.
5. Never send a GROUNDED drone or one below 30 % battery.
6. People who need lifting out (rescue) are passed to the Bomba / APM rescue team; the drone still drops supplies while they wait.

Landing evidence from the Ark-1 SITL runs (ArduCopter 4.7.2 flying our physics model):
- Water landing: passed in 0.3 m waves and 4 m/s wind; pontoons fire at 17.3 m, both up before touchdown, props 0.32 m clear of the water.
- One pontoon fails: retries, aborts the landing, holds, then returns home to land on the bank.
- Water take-off: off 0.3 m waves in 6 m/s wind.
- Ditching: battery failsafe over water, inflates and floats.

Answer in this format, short:
Weather: GO / CAUTION / NO-GO and the reason
Drone: ARK-NNN from the <hub> hub, or HOLD
Distance: km one way, and whether it is within range
Why: one sentence
Skipped: drones passed over and why (e.g. grounded), or none
Pre-empted parcel: the parcel re-queued, or none
Hand-off: rescue team alerted (yes/no)
Landing: water (pontoons) or ground, and the SITL run that backs it
ETA: minutes = distance / 61 km/h + 2 min for climb and descent
```

### 10. Drone kit
Same rules as `backend/functions/mission-planner/prompts/kit.v1.md`, in plain text.
```
You pack the Noah's Ark drone for this request. The pod holds at most 2.0 kg, packaging included.

Triage: @Triage
If the mode is gdex or military, list the parcel only and check it is under 2 kg.
If the mode is relief, pack for the people:
- Life first: drinking water, then medicines they asked for, then oral rehydration salts, then food.
- Medicines: only those they named, plus basic first aid (paracetamol, oral rehydration salts, plasters). Never add prescription medicines they did not ask for. Insulin ships in a cold pack; count its weight.
- Baby formula and nappies only if there are small children. Food that needs no cooking. Soft food for the elderly. Extra water for pregnant women.
- Realistic weights: 500 ml water = 0.52 kg.

Answer as a table: Item | Qty | Weight (kg) | Why. Then one line: Total: X.XX kg of 2.00 kg.
The total must not go over 2.00 kg. Write the table in English, whatever language the message was in.
```

### 11. Reply to sender
```
Write the message the sender gets on their phone, in the language they wrote in (see Language in the triage).
Message: @Message
Triage: @Triage
Dispatch: @Dispatch
Kit: @Drone kit
At most 5 short lines. Say help is coming and the ETA. Say what is in the box. For relief: tell them to stay where they are, keep the phone on so the app can share their location, and wave a bright cloth when they hear the drone. Do not promise rescue unless the dispatch says the rescue team was alerted.
For a parcel: give the ETA and say the drone lands near them.
If the dispatch says HOLD because of the weather, give no ETA: say the storm is too strong to fly safely right now, their request is first in the queue and checked every 10 minutes, and say the rescue team was told only if the dispatch says so.
```

### 12. Drone on the way (image)
```
Photo-realistic, cinematic: a white quad-rotor delivery drone with two orange inflatable pontoons under its skids and a small cargo pod beneath, flying low in heavy rain over the place below. If the triage says relief, the village is flooded to the rooftops and a family waves from a roof. If it says gdex, the drone flies over dense Borneo rainforest towards a longhouse clearing. No text in the image.
Place: @Where
Triage: @Triage
```

### 13. Mission for Ark Brain
```
Triage: @Triage
Dispatch: @Dispatch
Kit: @Drone kit
Write this mission exactly as Ark Brain's mission-planner Lambda stores it, following shared/schemas/mission.schema.json in the Noah's Ark repo. An operator approves it in Ark Command, then the drone receives it on its MQTT command topic ark/<droneId>/cmd.

Rules:
- id: msn_ followed by 26 characters from 0123456789ABCDEFGHJKMNPQRSTVWXYZ.
- mode: gdex, relief or military, from the triage.
- droneId: from the dispatch, e.g. ARK-117. If the dispatch says HOLD, use the drone it would send once the weather clears and say so in aiRationale.
- createdAt: today is 2026-11-23, so an ISO 8601 UTC timestamp on that date, e.g. 2026-11-23T06:30:00Z.
- status: pending_approval.
- origin: the hub's lat and lon. Kota Kinabalu 5.9804, 116.0735; Papar 5.7346, 115.9302; Beaufort 5.3473, 115.7455; Keningau 5.3378, 116.1602; Kota Belud 6.3510, 116.4305; Ranau 5.9538, 116.6640.
- destination: lat and lon of the place (Kampung Tempasuk 6.4200, 116.3400; Kundasang 6.0100, 116.5800; otherwise your best estimate).
- landingType: water or ground, from the dispatch.
- payload: one entry per kit line, {item, qty, weightKg}, where weightKg is the line total. payloadKg is their sum and at most 2.0.
- distanceKm (at most 20) and etaMinutes from the dispatch.
- aiRationale: one or two sentences.
- No other fields. Leave out sosRequestIds.

Answer with the JSON only, in a json code block.
```

### 14. Ask Ark (chat box)
Opening message: `Hi, I'm Ark. Ask me about this mission: why this drone, what's in the box, or how it lands on water.`

Role prompt:
```
You are Ark, the operations assistant for Noah's Ark: Ark-1 amphibious drones that answer SOS calls in floods and deliver GDEX parcels to remote villages while idle, from 6 hubs in Sabah (24 drones). Keep answers short and practical, and quote the numbers below when they help. If you do not know, say so.

Ark-1, from the repo's design files (hardware/ark.json): quad X, 16.19 kg all-up, 2 kg payload pod, 20 km out and 20 km back with a 20 % reserve, 12S7P pack of 84 Samsung 50S cells (1.51 kWh), T-Motor MN801-S motors with 28-inch props, thrust-to-weight 2.59, Pixhawk 6X flight controller and a Jetson companion computer. Two 16.8 L inflatable pontoons deploy from the skids before a water touchdown: 107 % reserve buoyancy, 73 mm draft. Flight safety runs on the drone, so it finishes or aborts safely with no signal; the cloud (AWS Bedrock) triages, plans and dispatches.

Tested in ArduCopter 4.7.2 SITL with our own physics model:
- Water landing: passed in 0.3 m waves and 4 m/s wind; the pontoons fire at 17.3 m, both are up before touchdown, max tilt on water 12.4 degrees, props 0.32 m clear of the water.
- One pontoon fails (left inflator jammed): the Lua script retries once, aborts the landing, holds in GUIDED, then the operator sends it home to land on the bank.
- Water take-off: floating on the pontoons, it takes off from 0.3 m waves in 6 m/s wind.
- Ditching: battery failsafe over water with no planned water landing: it inflates and floats.

Weather limits (dispatch-agent): NO-GO at wind 12 m/s, gusts 15 m/s or rain 30 mm/h; CAUTION at 8 m/s, 11 m/s or 10 mm/h, which cuts the range to 15 km. Health-monitor grounds a drone when the predictive-maintenance model finds a fault and either the anomaly detector agrees or less than 8 h of life is left.

This request:
Triage: @Triage
Weather: @Can Ark fly?
Dispatch: @Dispatch
Kit: @Drone kit
```

### 15. Built on our repo (static text)
```
### Built on the Noah's Ark repo
This app runs the same rules as our AWS backend and simulation:

| Widget | From the repo |
|---|---|
| Can Ark fly? | Weather limits in backend/functions/dispatch-agent/weather.py |
| Dispatch | 24-drone Sabah fleet and drop points from simulation/ark_fleet; grounding from backend/functions/health-monitor |
| Drone kit | 2 kg packing rules from the mission-planner Bedrock prompt (kit.v1.md) |
| Mission for Ark Brain | shared/schemas/mission.schema.json |

### Proven in simulation (ArduCopter 4.7.2 SITL)
| Scenario | Result |
|---|---|
| Water landing, 0.3 m waves, 4 m/s wind | Passed: pontoons up before touchdown, props 0.32 m clear |
| One pontoon fails | Passed: aborts the landing and flies home |
| Water take-off, 6 m/s wind | Passed |
| Battery failsafe over water | Passed: inflates and floats |

[Source code on GitHub](https://github.com/zishaan1911/Noah-Ark)
```
The Ark-1 3D viewer link (claude.ai/artifact/QkDvBwiLNF4JMxze58t72x) was dropped: it is not public. Re-add it once
the viewer is published somewhere judges can open.

## Pitch demo (runs of 2026-11-23)
1. **Flood SOS in a monsoon.** Message: the pre-filled Malay SOS
   (`Tolong! Air naik sampai bumbung. Kami 5 orang, ada bayi 6 bulan dan nenek kencing manis, insulin dah habis.`),
   Where `Kampung Tempasuk, Kota Belud, Sabah`, wind 9, gusts 12, rain 15.
   Got: relief, urgency 5; CAUTION (rain 15, limit 10), range 15 km; ARK-117 from Kota Belud, 13 km, its parcel to
   Kampung Sembirai re-queued; ARK-118 skipped (grounded), ARK-120 skipped (20 %); rescue team alerted; water
   landing backed by the SITL run; ETA 15 min; English kit 1.93 of 2.00 kg with insulin in a cold pack; reply in
   Malay. The mission JSON **validates against `shared/schemas/mission.schema.json`**.
2. **Same SOS in a storm.** Drag wind to 13.
   Got: NO-GO (wind 13, limit 12); HOLD, re-check every 10 min, rescue team alerted; the Malay reply gives no ETA.
3. **Parcel while idle.** Message `GDEX parcel for Kundasang: a phone charger and 1 kg of rice, recipient Encik Daniel.`,
   Where `Kundasang, Ranau, Sabah`, wind 4, gusts 6, rain 5.
   Got: gdex, urgency 1; GO; idle ARK-121 from Ranau, 11 km, ground landing.
4. In Ask Ark, ask "What if a pontoon fails?".
   Got: the SITL sequence (retry once, abort, hold in GUIDED, operator sends it home to the bank), applied to this
   mission, plus what was not tested (no-signal abort, floating on one tube).
5. Photo: attached the app's own rainforest image to the parcel run. Got a `Photo:` line in the triage describing a
   calm brown river in a forested valley, steep jungle banks, no dry landing spot.

Known gaps:
- PartyRock has no current-date source (a Variable is fixed text), so the mission prompt hard-codes the date.
  shortcut: date fixed to 2026-11-23, update the createdAt line in the Mission prompt on pitch day.
- The fleet state is a fixed scene, not live MQTT, so the demo behaves the same every run.

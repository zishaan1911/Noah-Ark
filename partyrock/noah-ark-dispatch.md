# noah-ark-dispatch (Ark SOS on PartyRock)

**PartyRock app (Ark SOS, built 2026-11-24):** "Noah's Ark: Rescue & Delivery Drone Fleet" on iamzishaan's PartyRock.
**Share link:** <https://partyrock.aws/u/iamzishaan/hJn7bk5DlUb9/Noah's-Ark%253A-Rescue-and-Delivery-Drone-Fleet>

**Problem:** people die in floods, and parcels are hard to deliver through dense forest.
**Solution:** an SOS app that calls a purpose-built amphibious drone. While no one needs help, the same drone
delivers parcels.

## How it fits
```
PartyRock (Ark SOS): triage, reply to the sender, SOS JSON
  → copy →  Ark Command: hub, 2 kg kit, live weather, route, operator approval
  → drone:  ARK-006 on the live sim, or the 24-drone fleet dispatcher
```

PartyRock cannot call other apps, so the copy is the hand-off. This app triages the call and writes an SOS
request. The operator pastes it into Ark Command, which loads it, picks the hub, packs the kit, checks the
weather and plans the route. Flight safety stays on the drone.

| Part | From the repo |
|---|---|
| SOS JSON shape | `shared/schemas/sos-request.schema.json` and `common.schema.json` (`sosId`, `geo`, `timestamp`) |
| Hubs and drop points | `simulation/ark_fleet/network.py` |
| Weather, kit, dispatch, route | Ark Command (`apps/operator-dashboard/`) and the Ark Brain Lambdas, not this app |

Keep these in sync: if the SOS schema, the hubs or the drop points change in the repo, change the SOS prompt
here and in PartyRock.

## Edits to make in the live PartyRock app
Done on iamzishaan's remix on 2026-11-24 (steps 1–3 and 5). Step 4 is open: "SOS for Ark Command" and "Hand-off"
sit at the bottom, under the footer; drag them up under Reply to sender. Repeat these steps to update another copy.

1. **Delete these widgets:** Wind m/s, Gusts m/s, Rain mm/h (the three sliders); Can the drones fly?; Dispatch;
   Drone kit; Drone flight log; Mission for Ark Brain.
2. **Change these:**
   - **Meet the fleet:** retitle it **Ark SOS** and replace its text with widget 0 below.
   - **Triage:** replace the prompt with the Triage prompt below (SOS only, water landing line added).
   - **Reply to sender:** replace the prompt with the one below.
   - **Ask the drone:** retitle it **Ask Noah’s Ark** (curly apostrophe, see builder notes) and replace the prompt.
   - **Built on our repo:** replace the footer text with widget 15 below.
3. **Add these:**
   - **AI Output "SOS for Ark Command"** (Claude Sonnet 5.5), placed after Reply to sender, with the SOS prompt below.
   - **Static Text "Hand-off"** (widget 12b below), placed after it.
4. Put the widgets in the order of the table below.
5. Click **Release changes**, then re-snapshot the app so the snapshot shows the new version.

## Builder notes (PartyRock, Nov 2026)
- Widget titles may not contain `[ ] ( ) { } ' " \ < >`. A title with one of them silently fails to save, and so
  do the other fields edited with it. So the chat title is typed with a curly apostrophe: **Ask Noah’s Ark**.
- `@` references: type `@` plus the start of the title and pick from the list. A space ends the search, so type
  `@Can`, not `@Can the`.
- A public app keeps edits as a draft until **Release changes** is clicked.
- Sliders: Numeric type, min 0. The value is set in the app, not in the widget settings.
- Fast typing into the Static Text box drops characters. Paste the content in one go and read it back.

## Widgets (top to bottom)
| # | Type | Title | Settings |
|---|---|---|---|
| 0 | Static Text | Ark SOS | markdown, full width at the top |
| 1 | Text Input | Message | hint `Type an SOS in any language, or a parcel order`; pre-filled with demo 1 |
| 2 | Text Input | Where | hint `Village or place in Sabah, e.g. Kampung Tempasuk, Kota Belud`; pre-filled `Kampung Tempasuk, Kota Belud, Sabah` |
| 3 | File Upload | Photo | optional; `Optional: a photo of where you are (flood water, roof, clearing)` |
| 7 | AI Output | Triage | Claude Sonnet 5.5 |
| 11 | AI Output | Reply to sender | Claude Sonnet 5.5 |
| 12 | AI Output | SOS for Ark Command | Claude Sonnet 5.5 |
| 12b | Static Text | Hand-off | markdown |
| 14 | Chat Box | Ask Noah’s Ark | Claude Sonnet 5.5 |
| 15 | Static Text | Built on our repo | markdown |

### 0. Ark SOS (static text)
```
### Ark SOS
You can ask for help in any language. A fleet of 24 Ark-1 drones at 6 hubs in Sabah brings supplies to flooded
villages and remote places. A human operator approves every flight in Ark Command.

**Try it:** send the pre-filled Malay flood SOS, then copy the SOS for Ark Command.
```

### 7. Triage
```
Message: @Message
Place: @Where
You are the triage officer for Noah's Ark, a fleet of amphibious drones in Malaysia. This app takes SOS calls
only, so every call is relief.
Read the message and the place above.

Answer in exactly this format, no other text:
Mode: relief
Urgency: 1-5 (5 = someone may die without help)
Language: the language the message was written in
People: number, and how many are children, elderly, disabled or pregnant (write "unknown" if not said)
Needs: comma-separated from food, water, medicine, baby_supplies, shelter, rescue, other
Medical conditions: short list, e.g. insulin-dependent diabetes, or none
Medicines asked for: list, or none
Water landing: yes if the sender is surrounded by flood water or on a roof, else no
Summary: one sentence in English for the operator

Photo: if a photo is attached, add one last line: Photo: how deep the water looks and where a drone could land (on water, on a roof, on dry ground). If there is no photo, write Photo: none.
Photo (may be empty): @Photo
```

### 11. Reply to sender
```
Write the message the sender gets on their phone, in the language they wrote in (see Language in the triage).
Message: @Message
Triage: @Triage

At most 5 short lines. Say help is on the way, pending an operator's approval. Never give an ETA, a drone id or a
time: Ark Command decides those.
Give safety advice for the situation in the triage:
- Water landing: yes. Stay on the roof or the highest dry point, away from the edge, and keep the phone on.
- Water landing: no. Stay where you are, keep the phone on so the app can share your location, and wave a
  bright cloth when you hear the drone.
End with the sign-off: - Noah's Ark
```

### 12. SOS for Ark Command (AI Output)
```
Triage: @Triage
Message: @Message
Place: @Where

Output exactly one JSON object, in a json code block, and no other text. It follows sos-request.schema.json:
- id: "sos_" followed by exactly 26 characters from 0123456789ABCDEFGHJKMNPQRSTVWXYZ
- createdAt: an ISO 8601 UTC timestamp, e.g. 2026-11-24T06:30:00Z
- status: "triaged"
- report:
  - channel: "app"
  - location: { "lat": number, "lon": number } of the Place, from the list below. If the Place is not listed,
    give your best estimate.
  - language: the Language from the triage, as a BCP 47 tag (ms for Malay, en for English)
  - rawMessage: the Message word for word, escaped as a JSON string
  - peopleCount: the People number from the triage (1 if unknown)
  - needs: the Needs from the triage
- triage:
  - urgency: the Urgency from the triage, 1 to 5
  - needs: the Needs from the triage, using only food, water, medicine, baby_supplies, shelter, rescue, other.
    At least one.
  - peopleCount: the People number from the triage (1 if unknown)
  - medicalConditions: a list of short strings from the triage, or []
  - summary: the Summary from the triage: one or two sentences in English, at most 1000 characters
  - language: the same as report.language
  - waterLanding: true if the triage says Water landing: yes, else false

No other fields.

Places (lat, lon). Water = river or coastal stilt village, where the drone lands on the water.
Kota Kinabalu hub (5.9804, 116.0735):
- Tanjung Aru 5.9400, 116.0500 | Putatan 5.8820, 116.0450 | Penampang 5.9150, 116.1000
- Inanam 6.0310, 116.1030 | Menggatal 6.0200, 116.1700 | Kampung Kinarut 5.8950, 116.0300 (water)
Papar hub (5.7346, 115.9302):
- Kampung Benoni 5.6800, 115.9600 | Limbahau 5.7700, 116.0000 | Kawang 5.7400, 116.0300
- Kampung Pengalat Besar 5.7100, 115.9100 (water) | Kampung Kelanahan 5.7150, 115.9650
- Kampung Langkuas 5.6900, 115.9100 (water)
Beaufort hub (5.3473, 115.7455):
- Kampung Gadong 5.4200, 115.7800 | Lumadan 5.2900, 115.8300 | Kampung Padas Damit 5.3100, 115.7200 (water)
- Weston 5.2700, 115.6500 (water) | Kampung Kebatu 5.4500, 115.7300 | Kampung Mawao 5.3800, 115.8200
Keningau hub (5.3378, 116.1602):
- Bingkor 5.2900, 116.2500 | Apin-Apin 5.3300, 116.1000 | Kampung Liawan 5.4000, 116.2000
- Tulid 5.2800, 116.1600 | Pandewan 5.4300, 116.2000 | Kampung Mamaitom 5.3200, 116.0800
Kota Belud hub (6.3510, 116.4305):
- Kampung Taun Gusi 6.3300, 116.3500 | Kampung Pandasan 6.3000, 116.4000
- Kampung Tempasuk 6.4200, 116.3400 (water) | Kadamaian 6.2800, 116.5300
- Kampung Taginambur 6.3300, 116.4800 | Kampung Sembirai 6.4000, 116.4200
Ranau hub (5.9538, 116.6640):
- Kundasang 6.0100, 116.5800 | Poring 6.0400, 116.7000 | Kampung Nalapak 5.9900, 116.6200
- Kampung Luanti 5.9300, 116.7100 | Bundu Tuhan 5.9900, 116.5700 | Kampung Marakau 5.9100, 116.6100
```

Ark Command repairs a miscounted id or a bad timestamp, so these are not fatal.

### 12b. Hand-off (static text)
```
### Hand-off
Copy the SOS above (copy button), then switch to Ark Command. It loads the call automatically: fly it on the live
drone (Drone page) or send it to the fleet dispatcher (Fleet page). An operator approves every flight.
```

### 14. Ask Noah's Ark (chat box)
Opening message: `Hi, I'm Noah's Ark's assistant. Ask me how the Ark-1 fleet works, why a drone is held in bad weather, or how it lands on water.`

Role prompt:
```
You answer questions about Noah's Ark: the fleet of 24 Ark-1 drones at 6 hubs in Sabah, how SOS calls are triaged,
and how the drones fly and land. You are not one specific drone. Speak about the fleet and the drones in general,
and do not name a drone or say which one is coming. Keep answers short and practical, and quote the numbers below
when they help. If you do not know, say so. Flight safety runs on the drone, and an operator approves every flight
in Ark Command.

Every drone in the fleet is an Ark-1. From the repo's design files (hardware/ark.json): quad X, 16.19 kg all-up, 2 kg
payload pod, 20 km out and 20 km back with a 20 % reserve, 12S7P pack of 84 Samsung 50S cells (1.51 kWh), T-Motor
MN801-S motors with 28-inch props, thrust-to-weight 2.59, Pixhawk 6X flight controller and a Jetson companion
computer. Two 16.8 L inflatable pontoons deploy from the skids before a water touchdown: 107 % reserve buoyancy,
73 mm draft. Flight safety runs on the drone, so it finishes or aborts safely with no signal; the cloud (AWS Bedrock)
triages, plans and dispatches.

Tested in ArduCopter 4.7.2 SITL with our own physics model:
- Water landing: passed in 0.3 m waves and 4 m/s wind; the pontoons fire at 17.3 m, both are up before touchdown, max
  tilt on water 12.4 degrees, props 0.32 m clear of the water.
- One pontoon fails (left inflator jammed): the Lua script retries once, aborts the landing, holds in GUIDED, then the
  operator sends it home to land on the bank.
- Water take-off: floating on the pontoons, it takes off from 0.3 m waves in 6 m/s wind.
- Ditching: battery failsafe over water with no planned water landing: it inflates and floats.

Weather limits (dispatch-agent): NO-GO at wind 12 m/s, gusts 15 m/s or rain 30 mm/h; CAUTION at 8 m/s, 11 m/s or
10 mm/h, which cuts the range to 15 km. Health-monitor grounds a drone when the predictive-maintenance model finds a
fault and either the anomaly detector agrees or less than 8 h of life is left.
```

### 15. Built on our repo (static text)
```
### Built on the Noah's Ark repo
Dispatch, kit, weather and routing run in Ark Command on the live fleet.

[Source code on GitHub](https://github.com/zishaan1911/Noah-Ark)
```

## Pitch demo (SOS → Ark Command)
Run 1 recorded on 2026-11-24 with the released app: triage relief, urgency 5, Malay, water landing yes, insulin
flagged; Malay reply with no ETA; SOS JSON `sos_01JD8Q4M7ZK3V9XTBN2E5RFHCA` at 6.42, 116.34. Pasted into Ark
Command's Fleet page: 1.94 kg kit, nearest hub Kota Belud, and the fleet sim queued the order at urgency 5.

1. **Flood SOS, dispatched to the fleet.** Message: the pre-filled Malay SOS (`Tolong! Air naik sampai bumbung. Kami 5 orang, ada bayi 6 bulan dan nenek kencing manis, insulin dah habis.`), Where `Kampung Tempasuk, Kota Belud, Sabah`. Expect triage urgency 5 with water landing. Copy the SOS for Ark Command, switch to Ark Command (it loads the call), open the Fleet page and press Dispatch. Expect a relief mission in the Dispatcher feed.
2. **Same SOS, one live drone.** Same copy. Open the Drone page, press Review, then Send to ARK-006.

## History: the all-in-one version (2026-11-23)
The first version ran dispatch, weather, kit, flight log and mission inside PartyRock. Its runs, one line each:
1. Flood SOS in a monsoon: relief urgency 5, CAUTION range 15 km, ARK-117 from Kota Belud, water landing, ETA 15 min, mission JSON validated against the schema.
2. Same SOS in a storm (wind 13): NO-GO, HOLD, the Malay reply gives no ETA.
3. Parcel while idle: GDEX urgency 1, GO, idle ARK-121 from Ranau, ground landing.
4. Ask the drone: "Why were you picked?" and "What if a pontoon fails?" answered from the SITL sequence.
5. Photo of a calm brown river in a forested valley: the triage described it with no dry landing spot.
6. Drone-centred flood run: a 13-line flight log from PREFLIGHT to LANDED at Kota Belud, 43.6 % battery.
7. Full re-run of the released app: storm NO-GO with a hub log; monsoon CAUTION, log to LANDED HUB at 44.1 % after 28 min 30 s and 26 km.

Released and snapshotted on 2026-11-23.

## Known gaps
- The copy is the hand-off: PartyRock cannot call Ark Command, so an operator must copy and paste the SOS.
- shortcut: the SOS place list is hand-placed to about 1 km, enough for a demo; Ark Command snaps the spot before any flight, upgrade when a real landing spot matters.
- The fleet state is a fixed scene, not live MQTT, so the demo behaves the same every run.
- The Ark-1 3D viewer link (claude.ai/artifact/QkDvBwiLNF4JMxze58t72x) was dropped: it is not public. Re-add it to
  the footer once the viewer is published somewhere judges can open.

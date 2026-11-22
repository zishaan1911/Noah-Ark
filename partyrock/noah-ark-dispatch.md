# noah-ark-dispatch (flagship pitch app)

**Share link:** _TODO_ (build at https://partyrock.aws, then paste the link here)

**Problem:** people die in floods, and parcels are hard to deliver through dense forest.
**Solution:** an SOS app that calls a purpose-built amphibious drone. While no one needs help, the same drone
delivers parcels.

One app tells the whole story: type a message (an SOS in any language, or a parcel order) and Bedrock triages it,
decides whether an idle parcel drone gets pulled off its route, packs the 2 kg kit, and replies to the sender.

Drone facts used in the prompts come from `hardware/README.md`: 2 kg payload, 20 km out and back, flies in rain,
lands on water on two pontoons.

## Widgets
Build them in this order. In PartyRock, `@Name` in a prompt links to the widget with that title.

| # | Type | Title | Model |
|---|---|---|---|
| 1 | User input | Message | |
| 2 | User input | Where | |
| 3 | AI text | Triage | Claude (any Sonnet-class) |
| 4 | AI text | Dispatch | Claude |
| 5 | AI text | Drone kit | Claude |
| 6 | AI text | Reply to sender | Claude |
| 7 | Image | Drone on the way | default image model |
| 8 | Chatbot | Ask Ark | Claude |

### 1. Message (user input)
Placeholder: `Type an SOS in any language, or a parcel order`

### 2. Where (user input)
Placeholder: `Village or place, e.g. Kampung Tanjung, Kota Belud, Sabah`

### 3. Triage (AI text)
```
You are the triage officer for Noah's Ark, a fleet of amphibious delivery drones in Malaysia.
Read the message and the place.

Message: @Message
Place: @Where

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
```

### 4. Dispatch (AI text)
```
You are the Noah's Ark dispatcher. The fleet right now:
- ARK-001: idle at the hub, battery 100 %.
- ARK-002: flying a GDEX parcel run, 6 km from the hub, battery 70 %.
- ARK-003: charging, battery 35 %.

Each drone carries 2 kg, flies 20 km out and 20 km back, flies in rain and lands on water.
Rules:
1. Life first. An SOS with urgency 4 or 5 takes the nearest drone that can reach it, even if it is on a parcel
   run. The parcel goes back to the queue and is re-promised for later today.
2. Urgency 3 or less takes an idle drone; parcel runs are not interrupted.
3. A parcel order takes an idle drone only when no SOS is waiting.
4. People who need lifting out (rescue) are passed to the Bomba / APM rescue team; the drone still drops
   water, a light and a whistle while they wait.
5. Never send a drone below 30 % battery.

Triage:
@Triage

Answer in this format, short:
Drone: ARK-NNN
Why: one sentence
Pre-empted parcel: which drone was pulled off a parcel run, or none
Hand-off: rescue team alerted (yes/no)
Landing: on water (pontoons) or on ground, and why
ETA: minutes, assuming 50 km/h cruise and the place 10-15 km from the hub
```

### 5. Drone kit (AI text)
Same rules as the backend prompt `backend/functions/mission-planner/prompts/kit.v1.md`, in plain text.
```
You pack the Noah's Ark drone for this request. The pod holds at most 2.0 kg, packaging included.

Triage:
@Triage

If the mode is gdex or military, list the parcel only and check it is under 2 kg.
If the mode is relief, pack for the people:
- Life first: drinking water, then medicines they asked for, then oral rehydration salts, then food.
- Medicines: only those they named, plus basic first aid (paracetamol, oral rehydration salts, plasters).
  Never add prescription medicines they did not ask for. Insulin ships in a cold pack; count its weight.
- Baby formula and nappies only if there are small children. Food that needs no cooking. Soft food for the
  elderly. Extra water for pregnant women.
- Realistic weights: 500 ml water = 0.52 kg.

Answer as a table: Item | Qty | Weight (kg) | Why. Then one line: Total: X.XX kg of 2.00 kg.
The total must not go over 2.00 kg.
```

### 6. Reply to sender (AI text)
```
Write the message the sender gets on their phone, in the language they wrote in (see Language in the triage).
Message: @Message
Triage: @Triage
Dispatch: @Dispatch
Kit: @Drone kit

At most 5 short lines. Say help is coming and the ETA. Say what is in the box. For relief: tell them to stay
where they are, keep the phone on so the app can share their location, and wave a bright cloth when they hear
the drone. Do not promise rescue unless the dispatch says the rescue team was alerted.
For a parcel: give the ETA and say the drone lands near them.
```

### 7. Drone on the way (image)
```
Photo-realistic, cinematic: a white quad-rotor delivery drone with two orange inflatable pontoons under its skids
and a small cargo pod beneath, flying low in heavy rain over @Where. If the triage below says relief, the
village is flooded to the rooftops and a family waves from a roof. If it says gdex, the drone flies over dense
Borneo rainforest towards a longhouse clearing. No text in the image.
@Triage
```

### 8. Ask Ark (chatbot)
Initial prompt:
```
You are Ark, the operations assistant for Noah's Ark: an amphibious drone that answers SOS calls in floods and
delivers parcels to remote jungle villages while idle. Each drone carries 2 kg, flies 20 km out and back in
rain, and lands on water on two pontoons. Flight safety runs on the drone, so it finishes or aborts safely with
no signal. The cloud (AWS Bedrock) triages, plans and dispatches.
Answer questions about this request using:
Triage: @Triage
Dispatch: @Dispatch
Kit: @Drone kit
Keep answers short and practical.
```

## Demo inputs (for the pitch)
Run the SOS first, then the parcel, to show the same fleet doing both.

1. **Flood SOS (Malay).**
   Message: `Tolong! Air naik sampai bumbung. Kami 5 orang, ada bayi 6 bulan dan nenek kencing manis, insulin dah habis.`
   Where: `Kampung Tanjung, Kota Belud, Sabah`
   Expect: relief, urgency 5, ARK-002 pulled off its parcel run, water landing, kit with water, insulin in a cold
   pack, ORS, baby formula, reply in Malay.
2. **Jungle parcel.**
   Message: `GDEX parcel for Long Semadoh longhouse: phone charger and 1 kg of rice, recipient Encik Daniel.`
   Where: `Long Semadoh, Lawas, Sarawak`
   Expect: gdex, urgency 1, idle ARK-001, ground landing, kit under 2 kg.

## Output
What the judges see after one run: triage card, dispatch decision, packed kit table, the phone reply in the
sender's language, a picture of the drone on its way, and a chat to ask follow-ups.

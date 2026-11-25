# Noah's Ark

**An amphibious, all-weather delivery drone with an AI brain on AWS.**
*When the waters rise, the Ark still delivers.*

## Run the demo (one command)
```bash
./demo.sh                                                # Linux, macOS
powershell -ExecutionPolicy Bypass -File .\demo.ps1      # Windows
```
It builds the simulator image and trains the predictive-maintenance model on the first run (about 10 minutes, once),
starts the local stack, then opens Ark Command at <http://localhost:5173> and the
[PartyRock app](https://partyrock.aws/u/iamzishaan/hJn7bk5DlUb9/Noah's-Ark%253A-Rescue-and-Delivery-Drone-Fleet) in
the browser. Ctrl+C stops everything. Needs Docker (with compose) or Podman + `podman-compose`, Node 22 and a browser.

| Local service | Stands in for |
|---|---|
| `broker` (Mosquitto) | AWS IoT Core: every part talks through MQTT topics such as `ark/ARK-006/telemetry` |
| `sim` | The drone ARK-006: ArduCopter SITL firmware on Ark-1 physics, real terrain and live wind. Boots when Ark Command sends a delivery |
| `gateway` | The companion computer: MQTT commands to MAVLink for the autopilot |
| `fleet` | 24 more drones at 6 Sabah hubs and the dispatch optimiser |
| `health` | SageMaker: the predictive-maintenance model that grounds faulty drones |
| `sos-api` | API Gateway + Lambdas: takes SOS calls and triages them (Bedrock if `BEDROCK_MODEL_ID` and `AWS_REGION` are set, else keyword rules) |

Try it:
1. **Fleet** page (`#/fleet`): the drones, the dispatcher's reasons, open SOS calls.
2. Send an SOS as the phone app would; it shows up on the Fleet page:
   ```bash
   curl -X POST localhost:8080/v1/sos -H 'content-type: application/json' -d '{"channel":"app","location":{"lat":6.4,"lon":116.4},"language":"ms","rawMessage":"Tolong! Air naik sampai bumbung. Kami 5 orang, ada bayi, perlu air dan ubat."}'
   ```
3. **GDEX** page: pick a start and a destination, Plan → Review → Send, then watch the flight in Map, Chase and Onboard.
4. **Defence** page (`#/defence`): plan a resupply around the threat zones and authorise it with a second operator.
5. **PartyRock**: triage an SOS with Bedrock, copy its SOS JSON and paste it into Ark Command.

## Components
| Name | What it is | Folder |
|---|---|---|
| **Ark** | The amphibious delivery drone (hardware + edge AI) | `hardware/`, `edge/`, `simulation/` |
| **Ark Brain** | AWS + Bedrock AI layer: triage, planning, dispatch, forecasting | `backend/`, `ml/`, `infra/` |
| **Ark Command** | Operator dashboard | `apps/operator-dashboard/` |
| **Ark Care** | Maintainer dashboard | `apps/maintainer-dashboard/` |
| **Ark SOS** | Mobile app for people seeking help | `apps/sos-mobile/` |

Autonomous delivery drone that **flies in rain**, **lands on water**, and **offloads tasks to AWS**.
Hackathon theme: GovTech & Social Impact (AWS x GDEX). Target award: **Best Logistics AI Solution**.

## Use cases
1. **GDEX jungle last-mile**: deliveries to remote interior communities in Sabah & Sarawak.
2. **Disaster relief**: food & medicine to people stranded by floods and other calamities.
3. **Defence logistics**: frontline resupply for the Malaysian Armed Forces; home-grown defence tech.

## Repo layout
| Folder | What lives there |
|---|---|
| `docs/` | Pitch, architecture, use cases, AI integration, diagrams |
| `hardware/` | Electronics design (schematics, PCB, BOM) and mechanical notes |
| `edge/` | Onboard companion-computer code: perception, offload manager, flight-controller bridge |
| `simulation/` | PX4/ArduPilot SITL + Gazebo worlds (jungle, flood, rain), missions, scripts |
| `ml/` | Model training: water-landing classifier, sensor fusion, predictive maintenance, flood demand forecast |
| `backend/` | AWS Lambda functions (Bedrock-powered triage, planning, dispatch agent, reports) + knowledge base |
| `apps/` | Operator dashboard, maintainer dashboard, SOS mobile app |
| `partyrock/` | Prompts & specs for PartyRock companion apps |
| `infra/` | AWS CDK infrastructure as code |
| `shared/` | JSON schemas shared across edge, backend and apps |

## AWS services
Bedrock (+ Agents, Knowledge Bases), PartyRock, IoT Core, IoT Greengrass, Location Service, Lambda,
Step Functions, DynamoDB, Timestream, SageMaker, Transcribe, Translate, Rekognition, SNS, Amplify, S3.

## Scope
Electronics are **designed** and the drone is **simulated**. No physical build.

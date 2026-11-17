# Noah's Ark

**An amphibious, all-weather delivery drone with an AI brain on AWS.**
*When the waters rise, the Ark still delivers.*

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
Electronics are **designed** and the drone is **simulated**, then **physically built**.

# Ark Brain: Backend (AWS Lambda + Bedrock)
| Function | Purpose | Key services |
|---|---|---|
| `sos-triage` | Parse multilingual SOS text/voice/photo into a structured request + urgency | Bedrock, Transcribe, Translate |
| `mission-planner` | Natural-language order into a structured mission | Bedrock |
| `dispatch-agent` | Choose drone, hub, route; weather & no-fly aware | Bedrock Agents, Location Service |
| `telemetry-ingest` | Ingest drone telemetry from IoT Core | IoT Core, Timestream |
| `maintenance-assistant` | RAG over manuals & repair logs | Bedrock Knowledge Bases |
| `report-writer` | Mission summaries, NADMA sitreps, GDEX & military reports | Bedrock |

`knowledge-base/`: source docs (manuals, SOPs) indexed into Bedrock Knowledge Bases.

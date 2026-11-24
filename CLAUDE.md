# Noah's Ark: instructions for Claude

Amphibious all-weather delivery drone + AWS AI brain (AWS x GDEX hackathon, Best Logistics AI Solution).
See `README.md` for the project overview.

## Required skills (always use)
These project skills live in `.claude/skills/` and are **mandatory**, not optional. Load the relevant one **before** starting a task.

| Skill | When to use |
|---|---|
| `antigravity-protocol` (Antigravity 2.0) | Every coding, planning or file-editing task. Decides *how* to work: fast path vs strict planning, targeted edits |
| `ponytail` (level: full) | Every coding task. Decides *how much* to build: smallest complete change, no speculative code, end replies with what was skipped + risks. Source: github.com/DietrichGebert/ponytail (MIT) |
| `ponytail-review` / `ponytail-audit` | Before every PR (review the diff) and before submission (audit the repo) |
| `ponytail-debt` | Before submission: list every `shortcut:` comment |
| `parallel-sonnet` | Any task that splits into 2+ independent, file-disjoint pieces: fan out to Sonnet/Haiku agents, then review, test and commit |
| `drone-design` | Any drone hardware work in `hardware/`: sizing, airframe, power chain, harness, subsystems, viewer |
| `apple-design` | Any UI work: Ark Command, Ark Care, Ark SOS, PartyRock app UX, landing pages |

## Product rules
- Keep all three use cases: **GDEX jungle last-mile**, **disaster relief**, **defence logistics**. Each mission carries a `mode`: `gdex | relief | military`.
- AWS **Bedrock** and **PartyRock** must be used in the solution.
- **Hardware is design + simulation only; no physical build.** Design it to a buildable level of detail. Design inspiration: `../slipstream` (Gannet SX-01: machined unibody sized from the electronics, SPICE-modelled power chain, harness netlist, ArduPilot params + Lua, Blender renders).

## Components
| Name | What it is | Folder | Stack |
|---|---|---|---|
| **Ark** | The drone: electronics design, edge AI, simulation | `hardware/`, `edge/`, `simulation/` | Python 3.12, PX4/ArduPilot SITL + Gazebo, MAVLink |
| **Ark Brain** | Cloud AI + APIs | `backend/`, `ml/`, `infra/` | Python + TypeScript Lambdas, SageMaker, CDK (TypeScript) |
| **Ark Command** | Operator dashboard | `apps/operator-dashboard/` | React + Vite + TypeScript + Tailwind |
| **Ark Care** | Maintainer dashboard | `apps/maintainer-dashboard/` | React + Vite + TypeScript + Tailwind |
| **Ark SOS** | Mobile help app | `apps/sos-mobile/` | Android, Kotlin + Jetpack Compose |
| PartyRock apps | No-code Bedrock companion apps | `partyrock/` | PartyRock (spec + share link per app) |

## Architecture
```
Ark SOS (Android) ─┐                     ┌─> Ark Command (React)
SMS / WhatsApp ────┼─> API Gateway ──> Lambdas ──> DynamoDB / Timestream / S3
                   │        │            │  ├─ Bedrock (triage, planning, agents, reports)
                   │        │            │  ├─ Bedrock Knowledge Bases (maintenance RAG)
                   │        │            │  ├─ Location Service (routes, geofences)
                   │        │            │  └─ SageMaker endpoints (forecast, maintenance)
                   │        └──── AppSync / WebSocket ──> live updates ─> Ark Command, Ark Care
Ark drone (sim) <── IoT Core (MQTT) <──> Greengrass on companion computer (edge AI, offload manager)
```
- **Flight safety stays on the drone.** Real-time control, obstacle avoidance and landing decisions run onboard. The cloud plans, dispatches, analyses and forecasts. The drone must finish or abort a mission safely with no link.
- **Offload manager** decides per task: onboard vs cloud, based on link quality, battery and urgency.
- **Event-driven:** components talk through IoT topics and API events, not direct calls between Lambdas. Multi-step flows (SOS → triage → plan → dispatch) use Step Functions.
- **Contracts first:** `shared/schemas/*.schema.json` is the single source of truth for SOS requests, missions and telemetry. Change the schema first, then regenerate types, then update consumers.
  - TypeScript types: `json-schema-to-typescript`
  - Python models: `datamodel-code-generator` (Pydantic)
  - Kotlin models (kotlinx.serialization): `quicktype`
  - Generated files go in a `generated/` folder and are never hand-edited.

### Which Lambda language
- **Python:** anything AI-heavy (Bedrock, SageMaker, Transcribe): `sos-triage`, `mission-planner`, `dispatch-agent`, `maintenance-assistant`, `report-writer`.
- **TypeScript:** API, CRUD, streaming and glue: `telemetry-ingest`, REST/WebSocket handlers.
- New function: pick by the same rule and state the choice in its README.

## Folder structure (inside each package)
```
apps/<name>-dashboard/          React
  src/pages/  src/components/  src/hooks/  src/lib/  src/generated/
apps/sos-mobile/                Android (Gradle)
  app/src/main/java/com/noahark/arksos/{api,location,ui}/  app/src/test/  (types: shared/generated/kotlin)
backend/functions/<name>/       Python Lambda             | TypeScript Lambda
  handler.py                                              | src/index.ts
  prompts/*.md   (Bedrock prompts as files, versioned)    | test/*.test.ts
  tests/test_*.py                                         | package.json
  requirements.txt
infra/                          CDK (TypeScript)
  bin/app.ts  lib/<concern>-stack.ts   (iot, api, ai, data, location, hosting)
ml/<model>/                     train.py, evaluate.py, README.md (metrics + dataset)
edge/<module>/                  Python package, tests/
simulation/                     worlds/, models/, missions/, scripts/
```
- One README per package: what it does, how to run it, how to test it.
- No shared "utils" or "common" package until two packages really need the same code.

## Naming
| Thing | Convention | Example |
|---|---|---|
| Folders, non-code files | kebab-case | `sos-triage/`, `relief-kit-generator.md` |
| Python modules / functions | snake_case (PEP 8) | `offload_manager.py`, `score_urgency()` |
| Kotlin files | PascalCase file per main class; functions camelCase | `SosViewModel.kt`, `HoldButton()` |
| React components | PascalCase file + export | `MissionMap.tsx` |
| TS hooks / utils | camelCase | `useTelemetry.ts`, `formatEta.ts` |
| Types / classes | PascalCase | `SosRequest`, `Mission` |
| Constants, env vars | SCREAMING_SNAKE_CASE | `BEDROCK_MODEL_ID` |
| JSON / API fields | camelCase (matches schemas) | `peopleCount`, `batteryPct` |
| AWS resources | `noah-ark-<env>-<component>` | `noah-ark-dev-sos-triage` |
| Environments | `dev`, `demo` | |
| IoT MQTT topics | `ark/<droneId>/<channel>` | `ark/ARK-001/telemetry`, `ark/ARK-001/cmd`, `ark/ARK-001/events` |
| IDs | Drones `ARK-NNN`; others `<prefix>_<ulid>` | `ARK-003`, `sos_01J…`, `msn_01J…` |
| Bedrock prompt files | `<task>.v<N>.md` | `triage.v1.md` |

## Code rules
- **TypeScript:** strict mode, ESLint + Prettier, Vitest. No `any` without a one-line why.
- **Python:** 3.12, Ruff (lint + format), pytest, type hints on public functions. One `requirements.txt` per Lambda/package.
- **Kotlin/Android:** official Kotlin style, Android lint clean, JVM unit tests. Strings in resources (en, ms, zh, ta).
- **Bedrock:** model IDs and region come from config/env, never hard-coded. Prompts live in `prompts/` files, not inline strings. Bedrock outputs that drive actions (urgency, routes, payloads) are validated against the JSON schemas before use.
- **Secrets:** never committed. Use SSM Parameter Store / Secrets Manager; local values in `.env` (git-ignored), with a `.env.example` listing the keys.
- **Shortcuts:** any deliberate limit gets `shortcut: <the limit>, <when to upgrade>` (ponytail convention).
- **AWS region:** default `ap-southeast-1` (Singapore); use `ap-southeast-5` (Malaysia) for data where the needed services, especially Bedrock models, are available there.

## Verify before claiming done
| Folder type | Commands |
|---|---|
| React apps, TS Lambdas, infra | `npm run lint && npm test && npm run build` (infra: `npx cdk synth`) |
| Python (backend, ml, edge, simulation) | `ruff check . && ruff format --check . && pytest` |
| Android (`apps/sos-mobile`) | `./gradlew testDebugUnitTest lintDebug assembleDebug` |

## Git & GitHub
- Remote: `origin` → https://github.com/zishaan1911/Noah-Ark.git. **Ask before pushing.**
- `main` is always demo-able. Work on short-lived branches: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `chore/<topic>` (e.g. `feat/sos-triage`).
- **No Claude attribution:** no `Co-Authored-By: Claude` trailers or "Generated with Claude Code" lines in commits or PRs. Only exception: commits that touch nothing but Claude files (`CLAUDE.md`, `.claude/`).
- **Conventional Commits**, scope = component or folder: `feat(sos-triage): parse Malay SOS messages`, `fix(sos-mobile): keep location on retry`, `docs(pitch): add GDEX business model`.
- Small commits, one concern each. Run `ponytail-review` and the verify commands before opening a PR. PRs are squash-merged into `main`.

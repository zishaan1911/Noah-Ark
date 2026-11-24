# sos-triage

**Python** Lambda (AI-heavy: Bedrock). Reads one SOS and decides how urgent it is and what the sender needs.

## Input and output
- In: a `SosRequest` (`shared/schemas/sos-request.schema.json`), validated before use. Only its `report` is triaged.
- Out: a `SosTriage` (`$defs/triage`): `urgency` 1-5, `needs`, `peopleCount`, `medicalConditions`, English `summary`,
  `language`, `waterLanding`.

## How it works
1. **Bedrock** (Converse API, prompt `prompts/triage.v1.md`) triages the report. The first JSON object in the reply is
   validated against `$defs/triage` before it is used.
2. If `BEDROCK_MODEL_ID` / `AWS_REGION` are not set, or Bedrock fails or answers off-schema, **`rules.py`** triages by
   keyword (English and Malay) so a call is never left untriaged.
3. `triage(report, client=None)` returns `(triage, "bedrock" | "rules")`; `handler` returns just the triage.

## Config
| Env var | What |
|---|---|
| `BEDROCK_MODEL_ID` | Model for the Converse call |
| `AWS_REGION` | Bedrock region |
| `ARK_SCHEMAS_DIR` | Optional. Where the JSON schemas are; defaults to the repo's `shared/schemas` |

## Run
The local SOS API (`backend/local-api`) imports `triage` from here.

## Test
```bash
ruff check . && ruff format --check . && pytest
```
Tests use a fake Bedrock client, so no AWS account is needed.

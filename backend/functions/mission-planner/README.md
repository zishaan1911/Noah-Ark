# mission-planner

**Python** Lambda (AI-heavy: Bedrock). Today it plans the **supply kit** for one SOS. Drone choice and the route are
not in it yet.

## Input and output
- In: a `SosRequest` (`shared/schemas/sos-request.schema.json`), validated before use. The kit uses the sender's
  `report` (people, children, elderly, disabled, pregnant, needs, medicines, message) and the `triage` if present.
- Out: `{ payload, payloadKg, aiRationale }`, the kit fields of a `Mission`. Every line is validated against
  `mission.schema.json#/$defs/payloadItem`. `payloadKg` is the exact sum of the lines.

## How the kit is made
1. **Bedrock** (Converse API, prompt `prompts/kit.v1.md`) proposes candidate items with a unit weight, the most units
   worth sending, and a priority from 1 to 5. It ranks; it does not add up weights.
2. **Code** drops malformed candidates, then packs a bounded knapsack in grams under the payload cap. Extra units of
   one item are worth less, so the kit spreads across water, medicine and food.
3. The cap is `payloadKg.maximum` in the mission schema (2 kg, kept equal to `hardware/ark.json` by the `shared/`
   tests).
4. If Bedrock fails or proposes nothing usable, a standard relief kit is packed instead, and the rationale tells the
   operator to check it before approving.

## Config
| Env var | What |
|---|---|
| `BEDROCK_MODEL_ID` | Model for the Converse call |
| `AWS_REGION` | Bedrock region |
| `ARK_SCHEMAS_DIR` | Optional. Where the JSON schemas are; defaults to the repo's `shared/schemas` |

## Test
```bash
ruff check . && ruff format --check . && pytest
```
Tests use a fake Bedrock client, so no AWS account is needed.

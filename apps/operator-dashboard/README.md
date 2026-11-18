# Ark Command + Ark Care (staff dashboard)

One React + Vite + TypeScript + Tailwind app for staff. The signed-in user's Cognito group picks the view:

| View        | Route      | Cognito group |
| ----------- | ---------- | ------------- |
| Ark Command | `/command` | `operator`    |
| Ark Care    | `/care`    | `maintainer`  |

A user in both groups sees both. The app only hides views; the API enforces roles (Cognito authorizer).
Sign-in is a dev stub (pick a role) until `infra/` has the Cognito user pool.

## Run

From the repo root, enter the Nix shell (`direnv allow`, or `nix develop`), then:

```bash
cd apps/operator-dashboard
npm install
npm run dev
```

## API and live feed

`src/lib/api.ts` is a typed client for `shared/api/openapi.yaml`, using the generated types in
`shared/generated/typescript/`. `src/hooks/useLiveUpdates.ts` reads the WebSocket feed (`live-update` messages).

| Env var        | Unset (dev)                                                                                                    | Set                      |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `VITE_API_URL` | Mock API (MSW, `src/mocks/`) seeded from `shared/examples/`                                                    | The real REST stage      |
| `VITE_WS_URL`  | Mock feed: ARK-001 flying the SITL water landing (`simulation/results/water_landing.json`) at 10 Hz, on a loop | The real WebSocket stage |

The mocks only load in dev, never in a production build.

## Test

```bash
npm run lint && npm test && npm run build
```

TypeScript is pinned to 6.0 because typescript-eslint does not support 7 yet.

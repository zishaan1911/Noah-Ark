#!/usr/bin/env bash
# Runs the whole Noah's Ark demo on one machine: the local stack, Ark Command, and the PartyRock app.
#   ./demo.sh          Ctrl+C stops everything.
# Needs: Docker (with compose) or Podman (with podman-compose), Node 22, a browser.
set -euo pipefail
cd "$(dirname "$0")"

PARTYROCK_URL="https://partyrock.aws/u/iamzishaan/hJn7bk5DlUb9/Noah's-Ark%253A-Rescue-and-Delivery-Drone-Fleet"
DASHBOARD_URL="http://localhost:5173"

if command -v docker >/dev/null && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then  # docker info: the daemon is reachable, not just installed
  ENGINE=docker COMPOSE="docker compose"
elif command -v podman >/dev/null && command -v podman-compose >/dev/null; then
  ENGINE=podman COMPOSE=podman-compose
else
  echo "Install Docker (with compose) or Podman + podman-compose first." >&2
  exit 1
fi

open_url() { (xdg-open "$1" || open "$1") >/dev/null 2>&1 || echo "Open $1"; }

# 1. The simulator image (ArduCopter SITL + Ark-1 physics). The other services reuse it.
if ! $ENGINE image inspect noah-ark-sitl >/dev/null 2>&1; then
  echo "==> Building the simulator image (once)"
  $ENGINE build -t noah-ark-sitl simulation
fi

# 2. The predictive-maintenance model the health service loads. Trained in the sim image, so no local Python setup.
if [ ! -f ml/predictive-maintenance/out/model.joblib ]; then
  echo "==> Training the predictive-maintenance model (once, about 8 minutes)"
  $ENGINE run --rm -v "$PWD":/repo:Z -w /repo/ml/predictive-maintenance noah-ark-sitl \
    sh -c "pip install -q -r requirements.txt && python generate.py --days 14 --seed 7 && python train.py"
fi

# 3. The local stack: broker, live sim, gateway, fleet, health monitor, SOS API.
echo "==> Starting the local stack"
$COMPOSE up --build -d
trap 'echo "==> Stopping"; $COMPOSE down' EXIT

# 4. Ark Command.
cd apps/operator-dashboard
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install
(until curl -s -o /dev/null "$DASHBOARD_URL"; do sleep 1; done; open_url "$DASHBOARD_URL"; open_url "$PARTYROCK_URL") &
echo "==> Ark Command on $DASHBOARD_URL, PartyRock opening in the browser. Ctrl+C to stop."
npm run dev -- --port 5173 --strictPort

# Runs the whole Noah's Ark demo on one Windows machine: the local stack, Ark Command, and the PartyRock app.
#   powershell -ExecutionPolicy Bypass -File .\demo.ps1          Ctrl+C stops everything.
# Needs: Docker Desktop (or Podman + podman-compose), Node 22, a browser. Same steps as demo.sh.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$PartyRockUrl = "https://partyrock.aws/u/iamzishaan/hJn7bk5DlUb9/Noah's-Ark%253A-Rescue-and-Delivery-Drone-Fleet"
$DashboardUrl = 'http://localhost:5173'

function Test-Command($Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Native commands do not stop the script on failure, so check each exit code.
function Invoke-Checked {
  & $args[0] @($args | Select-Object -Skip 1)
  if ($LASTEXITCODE -ne 0) { throw "Failed: $($args -join ' ')" }
}

if ((Test-Command docker) -and (docker compose version 2>$null)) {
  $Engine = 'docker'; $Compose = @('docker', 'compose'); $Relabel = ''
} elseif ((Test-Command podman) -and (Test-Command podman-compose)) {
  # :Z relabels the bind mount for SELinux inside the Podman machine.
  $Engine = 'podman'; $Compose = @('podman-compose'); $Relabel = ':Z'
} else {
  throw 'Install Docker Desktop (with compose) or Podman + podman-compose first.'
}

# 1. The simulator image (ArduCopter SITL + Ark-1 physics). The other services reuse it.
& $Engine image inspect noah-ark-sitl *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host '==> Building the simulator image (once)'
  Invoke-Checked $Engine build -t noah-ark-sitl simulation
}

# 2. The predictive-maintenance model the health service loads. Trained in the sim image, so no local Python setup.
if (-not (Test-Path ml/predictive-maintenance/out/model.joblib)) {
  Write-Host '==> Training the predictive-maintenance model (once, about 8 minutes)'
  Invoke-Checked $Engine run --rm -v "${PWD}:/repo$Relabel" -w /repo/ml/predictive-maintenance noah-ark-sitl `
    sh -c 'pip install -q -r requirements.txt && python generate.py --days 14 --seed 7 && python train.py'
}

# 3. The local stack: broker, live sim, gateway, fleet, health monitor, SOS API.
Write-Host '==> Starting the local stack'
Invoke-Checked @Compose up --build -d
try {
  # 4. Ark Command.
  Push-Location apps/operator-dashboard
  if (-not (Test-Path .env)) { Copy-Item .env.example .env }
  if (-not (Test-Path node_modules)) { Invoke-Checked npm install }
  $Opener = Start-Job -ArgumentList $DashboardUrl, $PartyRockUrl -ScriptBlock {
    param($Dashboard, $PartyRock)
    while ($true) {
      try { Invoke-WebRequest $Dashboard -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 }
    }
    Start-Process $Dashboard
    Start-Process $PartyRock
  }
  Write-Host "==> Ark Command on $DashboardUrl, PartyRock opening in the browser. Ctrl+C to stop."
  npm run dev -- --port 5173 --strictPort
} finally {
  # Runs on Ctrl+C too.
  Pop-Location
  if ($Opener) { Remove-Job $Opener -Force }
  Write-Host '==> Stopping'
  & $Compose[0] @($Compose | Select-Object -Skip 1) down
}

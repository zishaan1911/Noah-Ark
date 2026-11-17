param(
    [Parameter(Mandatory)][string]$Repo,     # repo root (absolute)
    # Comma/space separated; one name per agent; briefs at .agents/briefs/<name>.md.
    # A name may carry its own model: `core:sonnet,pages:haiku`. Otherwise -Model is used.
    [Parameter(Mandatory)][string]$Names,
    [string]$Model = 'sonnet',
    # Preview the dashboard: each agent replays .agents/runs/<name>.log instead of running claude.
    [switch]$Replay,
    # Start the agents but don't open the dashboard (open it later with dashboard.ps1).
    [switch]$NoDashboard
)

# Fan out one agent per name, all in parallel, each as a HIDDEN background process, then open
# ONE dashboard window (dashboard.ps1) that shows every agent as a pane. The window can be
# moved to any display or resized, and closing it doesn't stop the agents.
# Returns immediately, so the Terminal panel's 2s auto-cancel never touches anything.
#
# Per <name>: brief .agents/briefs/<name>.md -> marker .agents/runs/<name>.done,
# raw transcript .agents/runs/<name>.log, readable feed .agents/runs/<name>.feed(.state).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $here 'run-agent.ps1'
$dashboard = Join-Path $here 'dashboard.ps1'
$runsDir = Join-Path $Repo '.agents\runs'
$feedDir = if ($Replay) { Join-Path $runsDir 'replay' } else { $runsDir }
New-Item -ItemType Directory -Force -Path $feedDir | Out-Null

$launched = @()
foreach ($entry in ($Names -split '[,\s]+' | Where-Object { $_ -ne '' })) {
    $parts = $entry -split ':', 2
    $name = $parts[0]
    $agentModel = if ($parts.Count -gt 1 -and $parts[1]) { $parts[1] } else { $Model }
    $brief = ".agents\briefs\$name.md"
    if (-not (Test-Path -LiteralPath (Join-Path $Repo $brief))) {
        Write-Host "SKIP: no brief at $brief" -ForegroundColor Yellow
        continue
    }
    $log = Join-Path $runsDir "$name.log"
    $argv = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$runner`"",
        '-Repo', "`"$Repo`"", '-Brief', $brief, '-Marker', ".agents\runs\$name.done",
        '-Log', "`"$log`"", '-Feed', "`"$(Join-Path $feedDir "$name.feed")`"", '-Model', $agentModel
    )
    if ($Replay) { $argv += @('-Replay', "`"$log`"") }

    # Hidden + redirected Start-Process survives the panel's Ctrl-C (a visible one would not).
    $hostOut = Join-Path $feedDir "$name.host.txt"
    Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $Repo -ArgumentList $argv `
        -RedirectStandardOutput $hostOut -RedirectStandardError "$hostOut.err"
    $launched += "${name}:$agentModel"
    Write-Host "started (hidden): $agentModel-$name  (brief: $brief)"
}

if ($launched.Count -gt 0 -and -not $NoDashboard) {
    # `cmd /c start` gives the dashboard its own console and process group, detached from the panel.
    Start-Process cmd.exe -WindowStyle Hidden -ArgumentList @(
        '/c', 'start', '""', '/D', $Repo, 'powershell.exe',
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $dashboard,
        '-Repo', $Repo, '-Names', ($launched -join ','), '-FeedDir', $feedDir
    )
    Write-Host 'dashboard: opened one window "Noah Ark agents"'
}

Write-Host "ALL_LAUNCHED count=$($launched.Count)"

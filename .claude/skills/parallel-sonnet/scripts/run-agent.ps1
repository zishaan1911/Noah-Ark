param(
    [Parameter(Mandatory)][string]$Repo,    # repo root (absolute)
    [Parameter(Mandatory)][string]$Brief,   # brief path, relative to repo
    [Parameter(Mandatory)][string]$Marker,  # completion marker path, relative to repo
    [Parameter(Mandatory)][string]$Log,     # raw stream-json transcript (absolute)
    [Parameter(Mandatory)][string]$Feed,    # readable feed for the dashboard (absolute); <Feed>.state holds the status
    [string]$Model = 'sonnet',
    # Preview only: render an existing transcript instead of calling claude (no tokens spent;
    # the marker and log go to %TEMP%, the real ones are left alone).
    [string]$Replay = ''
)

# One implementation agent, run HIDDEN in the background by launch.ps1 (it survives the
# Terminal panel's 2s Ctrl-C and keeps running if the dashboard is closed). The agent may only
# read and write files; a reviewer runs tests and commits.
#
# Outputs:
#   $Log         raw stream-json, for the reviewer
#   $Feed        one readable line per event, "<Color>`t<text>", for dashboard.ps1
#   $Feed.state  "state|files|reads|startedIso|endedIso|costUsd", rewritten as the run goes
#   $Marker      RUN_DONE line when the agent exits

$ErrorActionPreference = 'Continue'
$claude = Join-Path $env:APPDATA 'npm\claude.cmd'
$markerAbs = Join-Path $Repo $Marker
if ($Replay) {
    $leaf = [IO.Path]::GetFileNameWithoutExtension($Feed)
    $markerAbs = Join-Path $env:TEMP "replay-$leaf.done"
    $Log = Join-Path $env:TEMP "replay-$leaf.log"
}
$statePath = "$Feed.state"
foreach ($p in $markerAbs, $Log, $Feed, $statePath) { Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Feed) | Out-Null
Set-Location -LiteralPath $Repo

function Open-Shared([string]$Path) {
    $fs = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    $w = New-Object IO.StreamWriter($fs, (New-Object Text.UTF8Encoding($false)))
    $w.AutoFlush = $true
    $w
}
$logWriter = Open-Shared $Log
$feedWriter = Open-Shared $Feed

$stats = @{ reads = 0; files = @{}; started = Get-Date }
$result = $null

function Write-State([string]$State, [string]$Ended = '', [string]$Cost = '') {
    $line = '{0}|{1}|{2}|{3}|{4}|{5}' -f $State, $stats.files.Count, $stats.reads, $stats.started.ToString('o'), $Ended, $Cost
    try { [IO.File]::WriteAllText($statePath, $line) } catch { }
}

function Add-Feed([string]$Color, [string]$Text) {
    $indent = if ($Text -match '^( *)') { $Matches[1] } else { '' }
    $clean = ($Text.Trim() -replace '\s+', ' ')
    if ($clean) { $feedWriter.WriteLine("$Color`t$((Get-Date).ToString('HH:mm'))  $indent$clean") }
}

function Get-RelPath([string]$Path) {
    if (-not $Path) { return '' }
    $p = $Path -replace '/', '\'
    if ($p.StartsWith($Repo, [StringComparison]::OrdinalIgnoreCase)) { $p = $p.Substring($Repo.Length).TrimStart('\') }
    $p -replace '\\', '/'
}

function Show-Event([string]$Line) {
    if (-not $Line.StartsWith('{')) { Add-Feed 'DarkYellow' $Line; return }
    try { $e = $Line | ConvertFrom-Json } catch { return }

    switch ($e.type) {
        'assistant' {
            foreach ($c in @($e.message.content)) {
                if ($c.type -eq 'text' -and $c.text.Trim()) {
                    Add-Feed 'White' (($c.text.Trim() -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 2) -join '  ')
                }
                elseif ($c.type -eq 'tool_use') {
                    $i = $c.input
                    switch -Regex ($c.name) {
                        '^Write$' {
                            $f = Get-RelPath $i.file_path
                            $tag = if ($stats.files.ContainsKey($f)) { 'write' } else { 'new  ' }
                            $stats.files[$f] = $true
                            Add-Feed 'Green' "+ $tag $f"
                        }
                        '^(Edit|MultiEdit|NotebookEdit)$' {
                            $f = Get-RelPath $i.file_path; $stats.files[$f] = $true
                            Add-Feed 'Yellow' "~ edit  $f"
                        }
                        '^Read$' { $stats.reads++; Add-Feed 'DarkGray' "  read  $(Get-RelPath $i.file_path)" }
                        '^(Glob|Grep)$' { $stats.reads++; Add-Feed 'DarkGray' "  find  $($i.pattern)" }
                        '^TodoWrite$' { Add-Feed 'DarkCyan' '  plan  updated checklist' }
                        default { Add-Feed 'DarkGray' "  $($c.name)" }
                    }
                }
            }
            Write-State 'running'
        }
        'user' {
            foreach ($c in @($e.message.content)) {
                if ($c.type -eq 'tool_result' -and $c.is_error) {
                    $msg = if ($c.content -is [string]) { $c.content } else { ($c.content | ForEach-Object { $_.text }) -join ' ' }
                    Add-Feed 'Red' "! $msg"
                }
            }
        }
        'result' { $script:result = $e }
    }
}

Write-State 'starting'
Add-Feed 'DarkCyan' "  brief $($Brief -replace '\\', '/')"

$source = if ($Replay) {
    { Get-Content -LiteralPath $Replay -Encoding UTF8 | ForEach-Object { $_; Start-Sleep -Milliseconds 15 } }
} else {
    $prompt = "Read the file $Brief in this repository and implement everything it " +
        "specifies, following it exactly. Only read and write files; do not run any " +
        "shell, artisan, composer, npm, git, or test commands, and do not commit. " +
        "Mirror the existing modules and conventions already in this repo. " +
        "When finished, print DONE on its own line."
    { & $claude -p $prompt --model $Model --permission-mode acceptEdits --disallowedTools Bash --output-format stream-json --verbose 2>&1 }
}

& $source | ForEach-Object {
    $line = "$_"
    $logWriter.WriteLine($line)
    Show-Event $line
}

$code = if ($Replay) { 0 } else { $LASTEXITCODE }
$ok = ($code -eq 0) -and ($null -eq $result -or -not $result.is_error)
$state = if ($Replay -and $null -eq $result) { 'replayed' } elseif ($ok) { 'done' } else { "failed (exit $code)" }
$cost = if ($result -and $result.total_cost_usd) { '{0:N2}' -f [double]$result.total_cost_usd } else { '' }

if ($result -and $result.result) {
    Add-Feed 'DarkGray' '  ---- final report ----'
    foreach ($t in ($result.result.Trim() -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 12)) { Add-Feed 'Gray' "  $t" }
}
Add-Feed $(if ($ok) { 'Green' } else { 'Red' }) "== $($state.ToUpper()): $($stats.files.Count) files changed. Reviewer will test and commit. =="

Write-State $state (Get-Date).ToString('o') $cost
$logWriter.Close()
$feedWriter.Close()
"RUN_DONE exit=$code at $(Get-Date -Format o)" | Out-File -LiteralPath $markerAbs -Encoding utf8

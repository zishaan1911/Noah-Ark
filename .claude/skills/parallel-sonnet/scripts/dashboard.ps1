param(
    [Parameter(Mandatory)][string]$Repo,     # repo root (absolute)
    [Parameter(Mandatory)][string]$Names,    # same list given to launch.ps1 (`name` or `name:model`)
    [string]$FeedDir = '',                   # where the <name>.feed files are; default .agents\runs
    [string]$Model = 'sonnet'
)

# One console window showing every agent as a pane in a grid. Drag it to any display; it
# re-lays out when resized. Closing it (or pressing q) does NOT stop the agents, which run
# hidden in the background. Reopen it any time with the same -Names.

$ErrorActionPreference = 'Continue'
if (-not $FeedDir) { $FeedDir = Join-Path $Repo '.agents\runs' }
$raw = $host.UI.RawUI
$raw.WindowTitle = 'Noah Ark agents'
$raw.BackgroundColor = 'Black'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try { [Console]::CursorVisible = $false } catch { }

# A roomy starting size; ignored if the screen is smaller.
try {
    $max = $raw.MaxPhysicalWindowSize
    $w = [Math]::Min(180, $max.Width); $h = [Math]::Min(50, $max.Height)
    $raw.BufferSize = New-Object Management.Automation.Host.Size([Math]::Max($w, $raw.BufferSize.Width), [Math]::Max($h, $raw.BufferSize.Height))
    $raw.WindowSize = New-Object Management.Automation.Host.Size($w, $h)
    $raw.BufferSize = New-Object Management.Automation.Host.Size($w, $h)
} catch { }

$agents = @()
foreach ($entry in ($Names -split '[,\s]+' | Where-Object { $_ -ne '' })) {
    $parts = $entry -split ':', 2
    $agents += [pscustomobject]@{
        Name = $parts[0]
        Model = $(if ($parts.Count -gt 1 -and $parts[1]) { $parts[1] } else { $Model })
        Feed = Join-Path $FeedDir "$($parts[0]).feed"
        Sig = ''
    }
}
$accents = 'DarkCyan', 'DarkMagenta', 'DarkYellow', 'DarkGreen', 'DarkBlue', 'DarkRed'

function Read-Shared([string]$Path) {
    try {
        $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        $sr = New-Object IO.StreamReader($fs)
        $text = $sr.ReadToEnd()
        $sr.Close()
        $text
    } catch { '' }
}

function Fit([string]$Text, [int]$Width) {
    if ($Width -le 0) { return '' }
    if ($Text.Length -gt $Width) { return $Text.Substring(0, [Math]::Max(0, $Width - 1)) + '~' }
    $Text.PadRight($Width)
}

function Put([int]$X, [int]$Y, [string]$Text, [string]$Fg = 'Gray', [string]$Bg = 'Black') {
    try {
        [Console]::SetCursorPosition($X, $Y)
        Write-Host $Text -NoNewline -ForegroundColor $Fg -BackgroundColor $Bg
    } catch { }
}

function Get-Status($Agent) {
    $s = (Read-Shared "$($Agent.Feed).state").Trim()
    if (-not $s) { return @{ state = 'waiting'; files = 0; reads = 0; mins = 0; cost = ''; finished = $false } }
    $p = $s -split '\|'
    $start = [datetime]::Parse($p[3])
    $end = if ($p[4]) { [datetime]::Parse($p[4]) } else { Get-Date }
    @{
        state = $p[0]; files = $p[1]; reads = $p[2]
        mins = [Math]::Round(($end - $start).TotalMinutes, 1)
        cost = $p[5]
        finished = [bool]$p[4]
    }
}

$lastSize = ''
while ($true) {
    $W = $raw.WindowSize.Width
    $H = $raw.WindowSize.Height
    $size = "${W}x${H}"
    $force = $false
    if ($size -ne $lastSize) {
        try { $raw.BufferSize = New-Object Management.Automation.Host.Size($W, $H) } catch { }
        Clear-Host
        $lastSize = $size
        $force = $true
    }

    $n = $agents.Count
    $cols = if ($n -le 2) { $n } else { [int][Math]::Ceiling([Math]::Sqrt($n)) }
    if ($n -ge 5 -and $n -le 6) { $cols = 3 }
    if ($W -lt 100) { $cols = 1 }   # narrow window: stack the panes
    $rows = [int][Math]::Ceiling($n / $cols)
    $paneW = [int][Math]::Floor(($W - ($cols - 1)) / $cols)
    $paneH = [int][Math]::Floor(($H - 1 - ($rows - 1)) / $rows)   # last line is the footer
    $done = 0

    for ($i = 0; $i -lt $n; $i++) {
        $a = $agents[$i]
        $st = Get-Status $a
        if ($st.finished) { $done++ }
        $feed = Read-Shared $a.Feed
        $sig = "$($feed.Length)|$($st.state)|$($st.mins)"
        if (-not $force -and $sig -eq $a.Sig) { continue }
        $a.Sig = $sig

        $x = ($i % $cols) * ($paneW + 1)
        $y = [int][Math]::Floor($i / $cols) * ($paneH + 1)

        $bg = if ($st.state -like 'failed*') { 'DarkRed' } elseif ($st.state -eq 'done') { 'DarkGreen' } else { $accents[$i % $accents.Count] }
        $cost = if ($st.cost) { "  US`$$($st.cost)" } else { '' }
        $head = " $($a.Name)  [$($a.Model)]  $($st.state)  -  $($st.files) files, $($st.reads) reads, $($st.mins)m$cost"
        Put $x $y (Fit $head $paneW) 'White' $bg

        $lines = @($feed -split "`r?`n" | Where-Object { $_ })
        $bodyH = $paneH - 1
        $show = if ($lines.Count -gt $bodyH) { $lines[($lines.Count - $bodyH)..($lines.Count - 1)] } else { $lines }
        for ($r = 0; $r -lt $bodyH; $r++) {
            if ($r -lt $show.Count) {
                $cell = $show[$r] -split "`t", 2
                $fg = if ($cell.Count -eq 2) { $cell[0] } else { 'Gray' }
                $txt = if ($cell.Count -eq 2) { $cell[1] } else { $cell[0] }
                try { Put $x ($y + 1 + $r) (Fit " $txt" $paneW) $fg } catch { Put $x ($y + 1 + $r) (Fit " $txt" $paneW) }
            } else {
                Put $x ($y + 1 + $r) (' ' * $paneW)
            }
        }
    }

    $footer = if ($done -eq $n) { " All $n agents finished.  q close" } else { " $done/$n finished.  q close dashboard (agents keep running)" }
    Put 0 ($H - 1) (Fit $footer ($W - 1)) $(if ($done -eq $n) { 'Green' } else { 'DarkGray' })
    $raw.WindowTitle = "Noah Ark agents  -  $done/$n finished"

    if ([Console]::KeyAvailable) {
        $k = [Console]::ReadKey($true)
        if ($k.KeyChar -eq 'q') { break }
    }
    Start-Sleep -Milliseconds 500
}

try { [Console]::CursorVisible = $true } catch { }
Clear-Host

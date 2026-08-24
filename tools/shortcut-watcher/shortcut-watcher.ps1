<#
.SYNOPSIS
  Reports non-Steam games launched from Steam to Quest.

.DESCRIPTION
  Steam's Web API cannot see "Add a Non-Steam Game" shortcuts at all: they are
  absent from GetOwnedGames, and GetPlayerSummaries withholds gameid/gameextrainfo
  while one is running. Steam does track them locally, but only writes those files
  when the client exits -- useless if you leave Steam running for weeks.

  So this watches the process list instead. It reads the shortcut list out of
  Steam's shortcuts.vdf (for the appid, name and exe), then polls for those exes
  and reports start/stop to the Quest API.

  Runs unattended as a Scheduled Task -- see install-task.ps1.

.NOTES
  Requires PowerShell 5.1+. No admin rights, no modules.
#>

[CmdletBinding()]
param(
  # e.g. http://100.115.171.80:3007  (Tailscale IP; synology:3007 also works)
  [string] $ApiBase       = $env:QUEST_API_BASE,
  [string] $ApiKey        = $env:QUEST_API_KEY,
  [int]    $IntervalSec   = 30,
  # Steam userdata config dir; auto-detected when omitted.
  [string] $SteamConfigDir,
  # Only report a shortcut when Steam itself launched it (see Test-LaunchedFromSteam).
  [bool]   $RequireSteamLaunch = $true,
  # Run one poll and exit -- for testing.
  [switch] $Once,
  # Print the parsed shortcut list and exit. Needs no API config -- use it to
  # confirm Steam's files are being read correctly before installing the task.
  [switch] $DumpShortcuts
)

$ErrorActionPreference = 'Stop'

$StateDir   = Join-Path $env:LOCALAPPDATA 'Quest\shortcut-watcher'
$StateFile  = Join-Path $StateDir 'state.json'
$QueueFile  = Join-Path $StateDir 'pending.json'
$LogFile    = Join-Path $StateDir 'watcher.log'
$ConfigFile = Join-Path $StateDir 'config.json'

if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

# Config precedence: explicit parameters, then environment, then config.json.
# The scheduled task deliberately passes NO credentials on its command line --
# task arguments are visible to anyone who opens Task Scheduler.
if ((-not $ApiBase -or -not $ApiKey) -and (Test-Path $ConfigFile)) {
  try {
    $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    if (-not $ApiBase -and $cfg.apiBase) { $ApiBase = $cfg.apiBase }
    if (-not $ApiKey  -and $cfg.apiKey)  { $ApiKey  = $cfg.apiKey }
    if ($cfg.PSObject.Properties.Name -contains 'intervalSec' -and -not $PSBoundParameters.ContainsKey('IntervalSec')) {
      $IntervalSec = [int]$cfg.intervalSec
    }
  } catch {
    Write-Warning "config.json is unreadable: $($_.Exception.Message)"
  }
}

function Write-Log {
  param([string] $Message, [string] $Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Write-Output $line
  try {
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    # Keep the log from growing without bound.
    $f = Get-Item $LogFile
    if ($f.Length -gt 2MB) {
      $keep = Get-Content $LogFile -Tail 2000
      Set-Content -Path $LogFile -Value $keep -Encoding utf8
    }
  } catch { }
}

# ---------------------------------------------------------------------------
# shortcuts.vdf  (binary VDF)
#
# Layout per entry, after a 1-byte type tag:
#   \x02 appid \x00 <int32 LE>   \x01 appname \x00 <cstring>
#   \x01 exe   \x00 <cstring>    ... \x02 LastPlayTime \x00 <uint32 LE>
#
# The appid is stored as a SIGNED int32 and is negative for every shortcut (they
# all have the high bit set). Steam's localconfig.vdf keys its playtime rows by
# that same signed value -- which is what made these entries easy to miss.
# ---------------------------------------------------------------------------
function Get-SteamShortcuts {
  param([string] $ConfigDir)

  $path = Join-Path $ConfigDir 'shortcuts.vdf'
  if (-not (Test-Path $path)) { return @() }

  $bytes = [IO.File]::ReadAllBytes($path)
  # latin1 maps bytes 1:1 onto chars, so regex over the text recovers exact bytes.
  $text  = [Text.Encoding]::GetEncoding(28591).GetString($bytes)

  $result = @()
  # Split on the appid marker; each chunk is then one shortcut entry.
  $marker = [string]([char]2) + 'appid' + [string]([char]0)
  $chunks = $text.Split([string[]]@($marker), [StringSplitOptions]::None)

  for ($i = 1; $i -lt $chunks.Count; $i++) {
    $chunk = $chunks[$i]
    if ($chunk.Length -lt 4) { continue }

    $idBytes = New-Object byte[] 4
    for ($b = 0; $b -lt 4; $b++) { $idBytes[$b] = [byte][char]$chunk[$b] }
    $appIdUnsigned = [BitConverter]::ToUInt32($idBytes, 0)

    $name = ''
    $m = [regex]::Match($chunk, "(?i)\x01appname\x00([^\x00]*)\x00")
    if ($m.Success) { $name = $m.Groups[1].Value }

    $exe = ''
    $m = [regex]::Match($chunk, "(?i)\x01exe\x00([^\x00]*)\x00")
    if ($m.Success) { $exe = $m.Groups[1].Value.Trim([char]34) }

    $lastPlay = 0
    $m = [regex]::Match($chunk, "(?is)\x02LastPlayTime\x00(.{4})")
    if ($m.Success) {
      $lpBytes = New-Object byte[] 4
      for ($b = 0; $b -lt 4; $b++) { $lpBytes[$b] = [byte][char]$m.Groups[1].Value[$b] }
      $lastPlay = [BitConverter]::ToUInt32($lpBytes, 0)
    }

    if ($name -and $exe) {
      $result += [pscustomobject]@{
        AppId        = $appIdUnsigned
        Name         = $name
        Exe          = $exe
        ProcessName  = [IO.Path]::GetFileNameWithoutExtension($exe)
        LastPlayTime = $lastPlay
      }
    }
  }
  return $result
}

function Find-SteamConfigDir {
  param([string] $Override)
  if ($Override) { return $Override }

  $steam = $null
  try { $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath } catch { }
  if (-not $steam) { $steam = 'C:\Program Files (x86)\Steam' }
  $steam = $steam -replace '/', '\'

  $userdata = Join-Path $steam 'userdata'
  if (-not (Test-Path $userdata)) { return $null }

  # Pick the account whose config dir holds a shortcuts.vdf, most recent first --
  # correct for the single-account case and a sane guess otherwise.
  $candidates = @(Get-ChildItem $userdata -Directory |
    ForEach-Object { Join-Path $_.FullName 'config' } |
    Where-Object { Test-Path (Join-Path $_ 'shortcuts.vdf') })

  if ($candidates.Count -eq 0) { return $null }
  return ($candidates | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1)
}

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

function Get-RunningShortcut {
  param($Shortcuts)

  foreach ($sc in $Shortcuts) {
    $procs = @(Get-Process -Name $sc.ProcessName -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { continue }

    foreach ($p in $procs) {
      # Prefer an exact path match so two games sharing an exe name (Game.exe) are
      # not confused. .Path throws for processes we cannot open -- fall back to the
      # name match rather than dropping a real session.
      $path = $null
      try { $path = $p.Path } catch { }
      if ($path -and $sc.Exe -and ($path -ne $sc.Exe)) { continue }

      $started = $null
      try { $started = $p.StartTime } catch { }

      return [pscustomobject]@{
        Shortcut  = $sc
        Process   = $p
        StartTime = $started
      }
    }
  }
  return $null
}

<#
  "Launched from Steam" gate.

  Steam rewrites shortcuts.vdf at launch time, stamping that shortcut's
  LastPlayTime -- verified: a shortcut started at 20:37:55 produced a file write
  at 20:37:56 with Steam still running for another 50 minutes. So a LastPlayTime
  at or after the process start means Steam is what started it; launching the exe
  directly leaves the stamp untouched.

  Steam must also be running, which rules out a stale stamp from an earlier
  session being credited to a direct launch.
#>
function Test-LaunchedFromSteam {
  param($Running, [bool] $Required)

  if (-not $Required) { return $true }

  $steamProc = @(Get-Process -Name 'steam' -ErrorAction SilentlyContinue)
  if ($steamProc.Count -eq 0) { return $false }

  if (-not $Running.StartTime) { return $true }   # couldn't read it; don't drop a real session
  if ($Running.Shortcut.LastPlayTime -le 0) { return $false }

  $stamp = [DateTimeOffset]::FromUnixTimeSeconds($Running.Shortcut.LastPlayTime).LocalDateTime
  # Slack in both directions: Steam writes the stamp a beat before the process
  # appears, and the file write can lag the launch slightly.
  return ($stamp -gt $Running.StartTime.AddMinutes(-5))
}

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

function Invoke-Quest {
  param([string] $Path, [hashtable] $Body)

  $uri  = "$($ApiBase.TrimEnd('/'))$Path"
  $json = $Body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri $uri -Method Post -Body $json -ContentType 'application/json' -Headers @{ 'X-Api-Key' = $ApiKey } -TimeoutSec 20
}

function Save-Json {
  param([string] $Path, $Object)
  # -InputObject, not the pipeline: piping unrolls the array, and an EMPTY array
  # piped to ConvertTo-Json yields $null -- which Set-Content silently declines to
  # write, leaving the previous contents in place. That is how a drained queue
  # would resurrect itself and re-POST every stop on every poll, forever.
  $json = ConvertTo-Json -InputObject $Object -Depth 6
  if ($null -eq $json -or $json -eq '') { $json = '[]' }
  Set-Content -Path $Path -Value $json -Encoding utf8
}

function Read-Json {
  param([string] $Path)
  if (-not (Test-Path $Path)) { return $null }
  try { return (Get-Content $Path -Raw | ConvertFrom-Json) } catch { return $null }
}

# Stops are queued rather than fired and forgotten: the clientUid makes the POST
# idempotent, so retrying until it lands can only ever record the session once.
function Add-PendingStop {
  param($Stop)
  $queue = @(Read-Json $QueueFile | Where-Object { $_ })
  $queue += $Stop
  Save-Json $QueueFile $queue
}

function Send-PendingStops {
  $queue = @(Read-Json $QueueFile | Where-Object { $_ })
  if ($queue.Count -eq 0) { return }

  $remaining = @()
  foreach ($stop in $queue) {
    try {
      $body = @{
        appId     = $stop.appId
        name      = $stop.name
        startedAt = $stop.startedAt
        endedAt   = $stop.endedAt
        clientUid = $stop.clientUid
      }
      $res = Invoke-Quest -Path '/api/ingest/steam-shortcut/stop' -Body $body
      Write-Log "reported '$($stop.name)' -> $($res.status) ($($res.minutes) min)"
    } catch {
      Write-Log "stop POST failed for '$($stop.name)', will retry: $($_.Exception.Message)" 'WARN'
      $remaining += $stop
    }
  }
  Save-Json $QueueFile $remaining
}

# ---------------------------------------------------------------------------
# Main poll
# ---------------------------------------------------------------------------

function Invoke-Poll {
  param([string] $ConfigDir, [bool] $RequireLaunch)

  Send-PendingStops

  $shortcuts = Get-SteamShortcuts -ConfigDir $ConfigDir
  $running   = Get-RunningShortcut -Shortcuts $shortcuts
  $state     = Read-Json $StateFile
  $nowIso    = (Get-Date).ToString('o')

  if ($running -and -not (Test-LaunchedFromSteam -Running $running -Required $RequireLaunch)) {
    # Running, but not started by Steam -- out of scope by design.
    $running = $null
  }

  if ($running) {
    $sc = $running.Shortcut

    if ($state -and ($state.appId -eq $sc.AppId)) {
      # Same session continuing.
      $state.lastSeen = $nowIso
      $state.endedAt  = $nowIso
    } else {
      if ($state) {
        # Switched games without us seeing the first one exit.
        Write-Log "session ended (switch): '$($state.name)'"
        $state.endedAt = $state.lastSeen
        Add-PendingStop $state
      }
      $startIso = $nowIso
      if ($running.StartTime) { $startIso = $running.StartTime.ToString('o') }
      $state = [pscustomobject]@{
        appId     = $sc.AppId
        name      = $sc.Name
        startedAt = $startIso
        endedAt   = $nowIso
        lastSeen  = $nowIso
        clientUid = [guid]::NewGuid().ToString()
      }
      Write-Log "session started: '$($sc.Name)' (appid $($sc.AppId))"
    }

    Save-Json $StateFile $state

    try {
      Invoke-Quest -Path '/api/ingest/steam-shortcut/heartbeat' -Body @{ appId = $sc.AppId; name = $sc.Name } | Out-Null
    } catch {
      Write-Log "heartbeat failed: $($_.Exception.Message)" 'WARN'
    }
  }
  elseif ($state) {
    # Was playing, now not. endedAt is the last time we SAW it alive, so a watcher
    # that was killed mid-session (or a machine that slept) does not bank the gap.
    Write-Log "session ended: '$($state.name)'"
    $state.endedAt = $state.lastSeen
    Add-PendingStop $state
    Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
    Send-PendingStops
  }
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if ($DumpShortcuts) {
  $configDir = Find-SteamConfigDir -Override $SteamConfigDir
  if (-not $configDir) { throw 'Could not locate a Steam userdata config dir containing shortcuts.vdf' }
  Write-Output "config dir: $configDir"
  Get-SteamShortcuts -ConfigDir $configDir | ForEach-Object {
    $stamp = '(never)'
    if ($_.LastPlayTime -gt 0) {
      $stamp = [DateTimeOffset]::FromUnixTimeSeconds($_.LastPlayTime).LocalDateTime.ToString('yyyy-MM-dd HH:mm:ss')
    }
    $signed = [int64]$_.AppId - 4294967296
    $isRunning = @(Get-Process -Name $_.ProcessName -ErrorAction SilentlyContinue).Count -gt 0
    [pscustomobject]@{
      Name         = $_.Name
      AppId        = $_.AppId
      SignedAppId  = $signed
      Process      = $_.ProcessName
      Running      = $isRunning
      LastPlayed   = $stamp
    }
  } | Format-List
  return
}

if (-not $ApiBase) { throw 'ApiBase is required (pass -ApiBase or set QUEST_API_BASE)' }
if (-not $ApiKey)  { throw 'ApiKey is required (pass -ApiKey or set QUEST_API_KEY)' }

$configDir = Find-SteamConfigDir -Override $SteamConfigDir
if (-not $configDir) { throw 'Could not locate a Steam userdata config dir containing shortcuts.vdf' }

Write-Log "watcher started - config: $configDir, api: $ApiBase, interval: ${IntervalSec}s"
$names = ((Get-SteamShortcuts -ConfigDir $configDir) | ForEach-Object { $_.Name }) -join ', '
Write-Log "watching shortcuts: $names"

if ($Once) {
  Invoke-Poll -ConfigDir $configDir -RequireLaunch $RequireSteamLaunch
  return
}

while ($true) {
  try {
    Invoke-Poll -ConfigDir $configDir -RequireLaunch $RequireSteamLaunch
  } catch {
    Write-Log "poll error: $($_.Exception.Message)" 'ERROR'
  }
  Start-Sleep -Seconds $IntervalSec
}

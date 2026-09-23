<#
.SYNOPSIS
  Uploads new Steam screenshots to Quest, and (optionally) detects and paints out
  their UI on this PC's GPU.

.DESCRIPTION
  Watches Steam's screenshot folders (userdata\<id>\760\remote\<appid>\screenshots)
  and uploads each new shot to the Quest API, which scores it and puts it in the
  review inbox. Steam's own files are never modified or deleted.

  With vision installed (install-task.ps1 -WithVision), each poll also:
    1. runs the text detector over newly uploaded shots and reports subtitle /
       corner-prompt boxes, and
    2. takes the API's inpaint queue, paints the masked UI out with LaMa, and
       uploads the cleaned copies.

  Only screenshots taken after the first run are uploaded. Older ones: -Backfill.

  Runs unattended as a Scheduled Task -- see install-task.ps1.

.EXAMPLE
  .\screenshot-sync.ps1 -Once                         # one poll, then exit
  .\screenshot-sync.ps1 -Backfill -AppId 1145350      # upload one game's old shots
  .\screenshot-sync.ps1 -Backfill -All                # upload every old shot

.NOTES
  Requires PowerShell 5.1+. No admin rights, no modules.
#>

[CmdletBinding()]
param(
  [string] $ApiBase     = $env:QUEST_API_BASE,
  [string] $ApiKey      = $env:QUEST_API_KEY,
  [int]    $IntervalSec = 60,
  # Steam userdata\<id> dir; auto-detected when omitted.
  [string] $SteamUserDir,
  [switch] $Once,
  # Upload screenshots taken before this agent was installed, then exit.
  [switch] $Backfill,
  [string] $AppId,
  [switch] $All
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # Invoke-WebRequest's progress bar is very slow in 5.1

$StateDir     = Join-Path $env:LOCALAPPDATA 'Quest\screenshot-sync'
$StateFile    = Join-Path $StateDir 'state.json'
$LogFile      = Join-Path $StateDir 'sync.log'
$ConfigFile   = Join-Path $StateDir 'config.json'
$WorkDir      = Join-Path $StateDir 'work'
$VenvPython   = Join-Path $StateDir 'venv\Scripts\python.exe'
$VisionScript = Join-Path $PSScriptRoot 'vision\vision.py'
# The shortcut watcher's config already holds the API base + key; reuse it.
$WatcherConfig = Join-Path $env:LOCALAPPDATA 'Quest\shortcut-watcher\config.json'

foreach ($d in @($StateDir, $WorkDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Config precedence: parameters, environment, own config.json, the watcher's.
foreach ($file in @($ConfigFile, $WatcherConfig)) {
  if ($ApiBase -and $ApiKey) { break }
  if (-not (Test-Path $file)) { continue }
  try {
    $cfg = Get-Content $file -Raw | ConvertFrom-Json
    if (-not $ApiBase -and $cfg.apiBase) { $ApiBase = $cfg.apiBase }
    if (-not $ApiKey  -and $cfg.apiKey)  { $ApiKey  = $cfg.apiKey }
  } catch {
    Write-Warning "$file is unreadable: $($_.Exception.Message)"
  }
}

function Write-Log {
  param([string] $Message, [string] $Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Write-Output $line
  try {
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    $f = Get-Item $LogFile
    if ($f.Length -gt 2MB) {
      $keep = Get-Content $LogFile -Tail 2000
      Set-Content -Path $LogFile -Value $keep -Encoding utf8
    }
  } catch { }
}

# ---------------------------------------------------------------------------
# State
#
# uploaded : sha256 -> { path, id }   every file the API has accepted (or ignored)
# pending  : path   -> { size, seenAt, retryAt }   files waiting to be uploaded
# baseline : ISO time of first run; older files are only sent by -Backfill
# ---------------------------------------------------------------------------

function Read-State {
  $s = $null
  if (Test-Path $StateFile) {
    try { $s = Get-Content $StateFile -Raw | ConvertFrom-Json } catch { $s = $null }
  }
  $state = @{ uploaded = @{}; pending = @{}; baseline = (Get-Date).ToString('o') }
  if ($s) {
    if ($s.baseline) { $state.baseline = $s.baseline }
    if ($s.uploaded) { foreach ($p in $s.uploaded.PSObject.Properties) { $state.uploaded[$p.Name] = $p.Value } }
    if ($s.pending)  { foreach ($p in $s.pending.PSObject.Properties)  { $state.pending[$p.Name]  = $p.Value } }
  }
  return $state
}

function Save-State {
  param($State)
  $json = ConvertTo-Json -InputObject $State -Depth 5 -Compress
  $tmp = "$StateFile.tmp"
  Set-Content -Path $tmp -Value $json -Encoding utf8
  Move-Item -Path $tmp -Destination $StateFile -Force
}

# ---------------------------------------------------------------------------
# Steam
# ---------------------------------------------------------------------------

function Find-SteamUserDir {
  param([string] $Override)
  if ($Override) { return $Override }

  $steam = $null
  try { $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop).SteamPath } catch { }
  if (-not $steam) { $steam = 'C:\Program Files (x86)\Steam' }
  $userdata = Join-Path ($steam -replace '/', '\') 'userdata'
  if (-not (Test-Path $userdata)) { return $null }

  # The account with the most recently written screenshot index.
  $candidates = @(Get-ChildItem $userdata -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName '760\remote') })
  if ($candidates.Count -eq 0) { return $null }
  return ($candidates |
    Sort-Object { (Get-Item (Join-Path $_.FullName '760')).LastWriteTime } -Descending |
    Select-Object -First 1).FullName
}

# Non-Steam shortcut names, keyed by unsigned appid -- lets the API match a
# shortcut it has never seen. Same parse as tools/shortcut-watcher.
function Get-ShortcutNames {
  param([string] $UserDir)
  $names = @{}
  $path = Join-Path $UserDir 'config\shortcuts.vdf'
  if (-not (Test-Path $path)) { return $names }

  $bytes = [IO.File]::ReadAllBytes($path)
  $text  = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
  $marker = [string]([char]2) + 'appid' + [string]([char]0)
  $chunks = $text.Split([string[]]@($marker), [StringSplitOptions]::None)
  for ($i = 1; $i -lt $chunks.Count; $i++) {
    $chunk = $chunks[$i]
    if ($chunk.Length -lt 4) { continue }
    $idBytes = New-Object byte[] 4
    for ($b = 0; $b -lt 4; $b++) { $idBytes[$b] = [byte][char]$chunk[$b] }
    $appId = [BitConverter]::ToUInt32($idBytes, 0)
    $m = [regex]::Match($chunk, "(?i)\x01appname\x00([^\x00]*)\x00")
    if ($m.Success) {
      # latin1 → the real UTF-8 name
      $raw = [Text.Encoding]::GetEncoding(28591).GetBytes($m.Groups[1].Value)
      $names[[string]$appId] = [Text.Encoding]::UTF8.GetString($raw)
    }
  }
  return $names
}

function Get-Screenshots {
  param([string] $UserDir, [string] $OnlyAppId)
  $remote = Join-Path $UserDir '760\remote'
  $dirs = if ($OnlyAppId) { @(Get-Item (Join-Path $remote $OnlyAppId) -ErrorAction SilentlyContinue) } else { @(Get-ChildItem $remote -Directory) }
  foreach ($d in $dirs) {
    if (-not $d) { continue }
    $shots = Join-Path $d.FullName 'screenshots'
    if (-not (Test-Path $shots)) { continue }
    # -File on the screenshots dir itself: the thumbnails\ subfolder is skipped.
    Get-ChildItem $shots -File -Filter '*.jpg' | ForEach-Object {
      [pscustomobject]@{ AppId = $d.Name; File = $_ }
    }
  }
}

function Get-TakenAt {
  param($File)
  # Steam names shots YYYYMMDDHHMMSS_N.jpg in this PC's local time. Send ISO with
  # the offset -- the API runs in UTC and would otherwise shift every shot.
  if ($File.Name -match '^(\d{14})_\d+\.jpg$') {
    $dt = [datetime]::ParseExact($Matches[1], 'yyyyMMddHHmmss', [Globalization.CultureInfo]::InvariantCulture)
    return [datetime]::SpecifyKind($dt, 'Local').ToString('o')
  }
  return $File.LastWriteTime.ToString('o')
}

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

function Get-Uri { param([string] $Path) return "$($ApiBase.TrimEnd('/'))$Path" }
function Get-Headers { return @{ 'X-Api-Key' = $ApiKey } }

function Get-StatusCode {
  param($ErrorRecord)
  try { return [int]$ErrorRecord.Exception.Response.StatusCode } catch { return 0 }
}

function Invoke-QuestJson {
  param([string] $Method, [string] $Path, $Body)
  $request = @{ Uri = (Get-Uri $Path); Method = $Method; Headers = (Get-Headers); TimeoutSec = 30 }
  if ($null -ne $Body) {
    $request.Body = (ConvertTo-Json -InputObject $Body -Depth 6 -Compress)
    $request.ContentType = 'application/json'
  }
  return Invoke-RestMethod @request
}

function Send-File {
  param([string] $Path, [string] $File)
  return Invoke-RestMethod -Uri (Get-Uri $Path) -Method Post -InFile $File -ContentType 'image/jpeg' `
    -Headers (Get-Headers) -TimeoutSec 120
}

# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

function Send-Screenshot {
  param($State, $Shot, $ShortcutNames)

  $path = $Shot.File.FullName
  $sha  = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
  if ($State.uploaded.ContainsKey($sha)) {
    $State.pending.Remove($path)
    return
  }

  $qs = @(
    "appId=$([uri]::EscapeDataString($Shot.AppId))",
    "takenAt=$([uri]::EscapeDataString((Get-TakenAt $Shot.File)))",
    "sha256=$sha"
  )
  $name = $ShortcutNames[$Shot.AppId]
  if ($name) { $qs += "name=$([uri]::EscapeDataString($name))" }

  try {
    $res = Send-File -Path "/api/ingest/screenshot?$($qs -join '&')" -File $path
    $State.uploaded[$sha] = @{ path = $path; id = $res.id }
    $State.pending.Remove($path)
    if ($res.status -eq 'created') { Write-Log "uploaded $($Shot.File.Name) (appid $($Shot.AppId)) -> #$($res.id)" }
    elseif ($res.status -eq 'ignored') { Write-Log "appid $($Shot.AppId) is ignored in Quest; skipping $($Shot.File.Name)" }
  } catch {
    $code = Get-StatusCode $_
    if ($code -eq 422) {
      # Quest can't tell which game this is yet (usually a non-Steam game it has
      # never seen). Try again later rather than every poll.
      $entry = $State.pending[$path]
      $entry.retryAt = (Get-Date).AddMinutes(30).ToString('o')
      Write-Log "appid $($Shot.AppId) not resolvable yet; retrying $($Shot.File.Name) in 30 min" 'WARN'
    } else {
      Write-Log "upload failed for $($Shot.File.Name), will retry: $($_.Exception.Message)" 'WARN'
    }
  }
}

function Invoke-Uploads {
  param($State, [string] $UserDir, [switch] $IncludeOld, [string] $OnlyAppId)

  $baseline = [datetime]::Parse($State.baseline)
  $shortcutNames = Get-ShortcutNames -UserDir $UserDir
  $now = Get-Date
  $known = @{}
  foreach ($v in $State.uploaded.Values) { if ($v.path) { $known[$v.path] = $true } }

  foreach ($shot in (Get-Screenshots -UserDir $UserDir -OnlyAppId $OnlyAppId)) {
    $path = $shot.File.FullName
    if ($known.ContainsKey($path)) { continue }
    if (-not $IncludeOld -and $shot.File.LastWriteTime -lt $baseline) { continue }

    $entry = $State.pending[$path]
    if (-not $entry) {
      # First sighting: Steam may still be writing it. Upload once the size has
      # held still for a poll.
      $State.pending[$path] = @{ size = $shot.File.Length; seenAt = $now.ToString('o'); retryAt = $null }
      if (-not $IncludeOld) { continue }
    } elseif ($entry.size -ne $shot.File.Length) {
      $entry.size = $shot.File.Length
      continue
    }

    $entry = $State.pending[$path]
    if ($entry.retryAt -and [datetime]::Parse($entry.retryAt) -gt $now) { continue }
    Send-Screenshot -State $State -Shot $shot -ShortcutNames $shortcutNames
  }

  # Forget pending files that have disappeared from Steam's folder.
  foreach ($p in @($State.pending.Keys)) {
    if (-not (Test-Path $p)) { $State.pending.Remove($p) }
  }
}

# ---------------------------------------------------------------------------
# Vision
# ---------------------------------------------------------------------------

function Test-Vision {
  return (Test-Path $VenvPython) -and (Test-Path $VisionScript)
}

function Find-LocalPath {
  param($State, [string] $Sha)
  $entry = $State.uploaded[$Sha]
  if ($entry -and $entry.path -and (Test-Path $entry.path)) { return $entry.path }
  return $null
}

function Invoke-Vision {
  param([string] $Command, $Jobs)
  $jobsFile = Join-Path $WorkDir "$Command-jobs.json"
  $outFile  = Join-Path $WorkDir "$Command-out.json"
  Set-Content -Path $jobsFile -Value (ConvertTo-Json -InputObject @($Jobs) -Depth 4) -Encoding utf8
  if (Test-Path $outFile) { Remove-Item $outFile -Force }

  $errFile = Join-Path $WorkDir "$Command-stderr.txt"
  $p = Start-Process -FilePath $VenvPython -ArgumentList @("`"$VisionScript`"", $Command, "`"$jobsFile`"", "`"$outFile`"") `
    -NoNewWindow -Wait -PassThru -RedirectStandardError $errFile
  if ($p.ExitCode -ne 0 -or -not (Test-Path $outFile)) {
    $err = if (Test-Path $errFile) { (Get-Content $errFile -Tail 5) -join ' | ' } else { '' }
    throw "vision $Command exited $($p.ExitCode): $err"
  }
  return (Get-Content $outFile -Raw | ConvertFrom-Json)
}

function Invoke-Detect {
  param($State)
  $queue = @((Invoke-QuestJson -Method Get -Path '/api/ingest/screenshots/detect-queue').items)
  if ($queue.Count -eq 0) { return }

  $jobs = @()
  foreach ($item in $queue) {
    $local = Find-LocalPath -State $State -Sha $item.sha256
    if ($local) {
      $jobs += @{ id = $item.id; path = $local }
    } else {
      # Not on this PC (deleted from Steam, or uploaded elsewhere). Report no
      # text so the shot isn't stuck waiting; HUD detection still applies.
      Invoke-QuestJson -Method Post -Path "/api/ingest/screenshot/$($item.id)/ui-boxes" -Body @{ boxes = @() } | Out-Null
    }
  }
  if ($jobs.Count -eq 0) { return }

  $result = Invoke-Vision -Command 'detect' -Jobs $jobs
  foreach ($job in $jobs) {
    $found = $result."$($job.id)"
    $boxes = if ($null -eq $found) { @() } else { @($found) }
    Invoke-QuestJson -Method Post -Path "/api/ingest/screenshot/$($job.id)/ui-boxes" -Body @{ boxes = $boxes } | Out-Null
    if ($boxes.Count -gt 0) { Write-Log "detected $($boxes.Count) UI text region(s) in #$($job.id)" }
  }
}

function Invoke-Inpaint {
  param($State)
  $queue = @((Invoke-QuestJson -Method Get -Path '/api/ingest/screenshots/inpaint-queue').items)
  if ($queue.Count -eq 0) { return }

  $jobs = @()
  foreach ($item in $queue) {
    $local = Find-LocalPath -State $State -Sha $item.sha256
    if (-not $local) {
      Invoke-QuestJson -Method Post -Path "/api/ingest/screenshot/$($item.id)/inpaint-failed" `
        -Body @{ maskVersion = $item.maskVersion; reason = 'original is not on this PC' } | Out-Null
      continue
    }
    $mask = Join-Path $WorkDir "mask-$($item.id).png"
    Invoke-WebRequest -Uri (Get-Uri "/api/ingest/screenshot/$($item.id)/mask.png") -Headers (Get-Headers) `
      -OutFile $mask -UseBasicParsing -TimeoutSec 60
    $jobs += @{
      id = $item.id; path = $local; mask = $mask
      out = (Join-Path $WorkDir "clean-$($item.id).jpg"); maskVersion = $item.maskVersion
    }
  }
  if ($jobs.Count -eq 0) { return }

  $result = Invoke-Vision -Command 'inpaint' -Jobs $jobs
  foreach ($job in $jobs) {
    $r = $result."$($job.id)"
    try {
      if ($r -and $r.ok) {
        $res = Send-File -Path "/api/ingest/screenshot/$($job.id)/cleaned?maskVersion=$($job.maskVersion)" -File $job.out
        Write-Log "removed UI from #$($job.id) ($($res.outcome))"
      } else {
        $reason = if ($r) { $r.error } else { 'no result' }
        Invoke-QuestJson -Method Post -Path "/api/ingest/screenshot/$($job.id)/inpaint-failed" `
          -Body @{ maskVersion = $job.maskVersion; reason = $reason } | Out-Null
        Write-Log "UI removal failed for #$($job.id): $reason" 'WARN'
      }
    } finally {
      Remove-Item $job.out, $job.mask -Force -ErrorAction SilentlyContinue
    }
  }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Invoke-Poll {
  param([string] $UserDir, [switch] $IncludeOld, [string] $OnlyAppId)

  $state = Read-State
  try {
    Invoke-Uploads -State $state -UserDir $UserDir -IncludeOld:$IncludeOld -OnlyAppId $OnlyAppId
  } finally {
    Save-State $state
  }

  if (Test-Vision) {
    try { Invoke-Detect -State $state } catch { Write-Log "detect step failed: $($_.Exception.Message)" 'WARN' }
    try { Invoke-Inpaint -State $state } catch { Write-Log "inpaint step failed: $($_.Exception.Message)" 'WARN' }
  }
}

if (-not $ApiBase) { throw 'ApiBase is required (pass -ApiBase, set QUEST_API_BASE, or run install-task.ps1)' }
if (-not $ApiKey)  { throw 'ApiKey is required (pass -ApiKey, set QUEST_API_KEY, or run install-task.ps1)' }

$userDir = Find-SteamUserDir -Override $SteamUserDir
if (-not $userDir) { throw 'Could not find a Steam userdata dir with screenshots (760\remote)' }

if ($Backfill) {
  if (-not $AppId -and -not $All) { throw '-Backfill needs -AppId <id> or -All' }
  Write-Log "backfill: $(if ($All) { 'all games' } else { "appid $AppId" }) from $userDir"
  Invoke-Poll -UserDir $userDir -IncludeOld -OnlyAppId $(if ($All) { '' } else { $AppId })
  Write-Log 'backfill done'
  return
}

# First run sets the baseline: everything already on disk counts as history.
if (-not (Test-Path $StateFile)) { Save-State (Read-State) }

Write-Log "screenshot sync started - steam: $userDir, api: $ApiBase, vision: $(Test-Vision), interval: ${IntervalSec}s"

if ($Once) {
  Invoke-Poll -UserDir $userDir
  return
}

while ($true) {
  try {
    Invoke-Poll -UserDir $userDir
  } catch {
    Write-Log "poll error: $($_.Exception.Message)" 'ERROR'
  }
  Start-Sleep -Seconds $IntervalSec
}

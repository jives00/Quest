<#
.SYNOPSIS
  Installs the Quest screenshot sync as a Scheduled Task that runs at logon, and
  optionally the GPU vision helper that removes UI.

.DESCRIPTION
  API credentials: pass -ApiBase/-ApiKey, or leave them off to reuse the shortcut
  watcher's config (%LOCALAPPDATA%\Quest\shortcut-watcher\config.json).

  -WithVision additionally creates a Python venv in
  %LOCALAPPDATA%\Quest\screenshot-sync\venv (needs Python 3.11+ on PATH or the
  py launcher), installs onnxruntime-directml + the text detector, and downloads
  the LaMa model (~200 MB) once. Re-running with -WithVision repairs/updates it.

  No admin rights needed.

.EXAMPLE
  .\install-task.ps1 -WithVision

.EXAMPLE
  .\install-task.ps1 -ApiBase http://100.115.171.80:3007 -ApiKey <SCROBBLE_API_KEY> -WithVision

.EXAMPLE
  .\install-task.ps1 -Uninstall
#>

[CmdletBinding()]
param(
  [string] $ApiBase,
  [string] $ApiKey,
  [switch] $WithVision,
  [string] $LamaUrl  = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx',
  [string] $TaskName = 'Quest Screenshot Sync',
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$stateDir      = Join-Path $env:LOCALAPPDATA 'Quest\screenshot-sync'
$configFile    = Join-Path $stateDir 'config.json'
$watcherConfig = Join-Path $env:LOCALAPPDATA 'Quest\shortcut-watcher\config.json'
$existing      = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Uninstall) {
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed scheduled task '$TaskName'."
    Write-Output "State, venv and models are left behind in $stateDir (delete it to reclaim ~1 GB)."
  } else {
    Write-Output "No scheduled task named '$TaskName' found."
  }
  return
}

$scriptPath = Join-Path $PSScriptRoot 'screenshot-sync.ps1'
if (-not (Test-Path $scriptPath)) { throw "screenshot-sync.ps1 not found next to this installer ($scriptPath)" }
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

# --- config ---------------------------------------------------------------
if ($ApiBase -or $ApiKey) {
  if (-not ($ApiBase -and $ApiKey)) { throw 'Pass both -ApiBase and -ApiKey, or neither (to reuse the shortcut watcher config).' }
  [pscustomobject]@{ apiBase = $ApiBase; apiKey = $ApiKey } |
    ConvertTo-Json | Set-Content -Path $configFile -Encoding utf8
  # The key is a credential: restrict the file to this user only.
  try {
    $acl = Get-Acl $configFile
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      "$env:USERDOMAIN\$env:USERNAME", 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -Path $configFile -AclObject $acl
  } catch {
    Write-Warning "Could not restrict permissions on config.json: $($_.Exception.Message)"
  }
  Write-Output "Wrote config to $configFile"
} elseif (Test-Path $watcherConfig) {
  Write-Output "Using the shortcut watcher's API config ($watcherConfig)."
} elseif (-not (Test-Path $configFile)) {
  throw 'No API config found. Pass -ApiBase and -ApiKey (the SCROBBLE_API_KEY from the API .env).'
}

# --- vision ---------------------------------------------------------------
if ($WithVision) {
  # Find a Python 3.11+: the py launcher first (picks the newest), then PATH.
  $python = $null
  foreach ($candidate in @(@('py', '-3'), @('python'))) {
    try {
      $exe = $candidate[0]; $rest = @($candidate | Select-Object -Skip 1)
      # Single quotes inside: Windows PowerShell 5.1 strips embedded double quotes
      # from native-command arguments.
      $ver = & $exe @rest -c 'import sys; print(''%d.%d'' % sys.version_info[:2])' 2>$null
      if ($LASTEXITCODE -eq 0 -and [version]$ver -ge [version]'3.11') { $python = $candidate; break }
    } catch { }
  }
  if (-not $python) { throw 'Python 3.11+ not found. Install it from python.org (tick "Add to PATH"), then re-run with -WithVision.' }

  $venv = Join-Path $stateDir 'venv'
  $venvPython = Join-Path $venv 'Scripts\python.exe'
  if (-not (Test-Path $venvPython)) {
    Write-Output "Creating venv at $venv ..."
    $exe = $python[0]; $rest = @($python | Select-Object -Skip 1)
    & $exe @rest -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'venv creation failed' }
  }

  # Run the vision code from a local copy, not from the synced repo folder:
  # Synology Drive can leave on-demand placeholders there that PowerShell opens
  # fine but Python cannot, and a sync mid-run could swap vision.py under the
  # task. Re-run the installer to pick up changes to vision\.
  $visionSrc = Join-Path $PSScriptRoot 'vision'
  $visionDst = Join-Path $stateDir 'vision'
  if (-not (Test-Path $visionDst)) { New-Item -ItemType Directory -Path $visionDst -Force | Out-Null }
  foreach ($name in @('vision.py', 'requirements.txt')) {
    $src = Join-Path $visionSrc $name
    if (-not (Test-Path $src)) { throw "Missing $src -- has the repo folder finished syncing?" }
    # Read + write rather than Copy-Item, so a placeholder is fully downloaded.
    [IO.File]::WriteAllBytes((Join-Path $visionDst $name), [IO.File]::ReadAllBytes($src))
  }
  Write-Output "Copied vision code to $visionDst"

  Write-Output 'Installing vision packages (a few minutes the first time) ...'
  & $venvPython -m pip install --quiet --upgrade pip
  & $venvPython -m pip install --quiet --upgrade -r (Join-Path $visionDst 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
  # --no-deps: its CPU onnxruntime dependency would replace onnxruntime-directml.
  & $venvPython -m pip install --quiet --upgrade --no-deps rapidocr_onnxruntime
  if ($LASTEXITCODE -ne 0) { throw 'pip install rapidocr_onnxruntime failed' }

  $models = Join-Path $stateDir 'models'
  if (-not (Test-Path $models)) { New-Item -ItemType Directory -Path $models -Force | Out-Null }
  $lama = Join-Path $models 'lama_fp32.onnx'
  if (-not (Test-Path $lama) -or (Get-Item $lama).Length -lt 100MB) {
    Write-Output 'Downloading the LaMa model (~200 MB) ...'
    $tmp = "$lama.part"
    Invoke-WebRequest -Uri $LamaUrl -OutFile $tmp -UseBasicParsing
    Move-Item $tmp $lama -Force
  }

  $providers = & $venvPython -c 'import onnxruntime as o; print('',''.join(o.get_available_providers()))'
  Write-Output "Vision ready. ONNX providers: $providers"
  if ($providers -notmatch 'Dml|CUDA') { Write-Warning 'No GPU provider found; UI removal will run on the CPU (slower, still works).' }
}

# --- task -----------------------------------------------------------------
# Launched through `conhost --headless` so no window ever appears. On Windows 11
# Windows Terminal is the default console host and ignores -WindowStyle Hidden,
# leaving a terminal window open for as long as the task runs.
$action = New-ScheduledTaskAction -Execute 'conhost.exe' `
  -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -RestartCount 3 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Replaced existing task '$TaskName'."
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'Uploads new Steam screenshots to Quest and removes their UI.' | Out-Null
Write-Output "Registered scheduled task '$TaskName' (starts at logon)."

Start-ScheduledTask -TaskName $TaskName
Write-Output 'Started it now, so you do not need to log out.'
Write-Output ''
Write-Output 'Only screenshots taken from now on are uploaded. For older ones:'
Write-Output "  .\screenshot-sync.ps1 -Backfill -AppId <steam appid>   (or -All)"
Write-Output ''
Write-Output 'Check it is working:'
Write-Output "  Get-Content `"$stateDir\sync.log`" -Tail 20 -Wait"

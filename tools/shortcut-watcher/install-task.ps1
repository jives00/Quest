<#
.SYNOPSIS
  Installs the Quest shortcut watcher as a Scheduled Task that runs at logon.

.DESCRIPTION
  Writes the API config to %LOCALAPPDATA%\Quest\shortcut-watcher\config.json and
  registers a task that starts the watcher at logon and restarts it if it dies.

  No admin rights needed: the task runs as the current user, which is also
  required for reading game process start times.

.EXAMPLE
  .\install-task.ps1 -ApiBase http://100.115.171.80:3007 -ApiKey <SCROBBLE_API_KEY>

.EXAMPLE
  # Remove it again
  .\install-task.ps1 -Uninstall
#>

[CmdletBinding()]
param(
  [string] $ApiBase,
  [string] $ApiKey,
  [int]    $IntervalSec = 30,
  [string] $TaskName    = 'Quest Shortcut Watcher',
  [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($Uninstall) {
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output "Removed scheduled task '$TaskName'."
    Write-Output "State and logs are left behind in $env:LOCALAPPDATA\Quest\shortcut-watcher"
  } else {
    Write-Output "No scheduled task named '$TaskName' found."
  }
  return
}

if (-not $ApiBase) { throw 'ApiBase is required, e.g. -ApiBase http://100.115.171.80:3007' }
if (-not $ApiKey)  { throw 'ApiKey is required -- use the SCROBBLE_API_KEY value from the API .env' }

$scriptPath = Join-Path $PSScriptRoot 'shortcut-watcher.ps1'
if (-not (Test-Path $scriptPath)) { throw "shortcut-watcher.ps1 not found next to this installer ($scriptPath)" }

# --- config ---------------------------------------------------------------
$stateDir = Join-Path $env:LOCALAPPDATA 'Quest\shortcut-watcher'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }

$configFile = Join-Path $stateDir 'config.json'
[pscustomobject]@{
  apiBase     = $ApiBase
  apiKey      = $ApiKey
  intervalSec = $IntervalSec
} | ConvertTo-Json | Set-Content -Path $configFile -Encoding utf8

# The key is a credential: restrict the file to this user only, dropping the
# inherited ACL that would otherwise let other local accounts read it.
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

# --- task -----------------------------------------------------------------
# -File (not -Command) so the path is passed intact; no credentials in the args.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -RestartCount 3 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)   # never kill it; it is meant to run forever

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Replaced existing task '$TaskName'."
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'Reports non-Steam games launched from Steam to Quest.' | Out-Null

Write-Output "Registered scheduled task '$TaskName' (starts at logon)."

Start-ScheduledTask -TaskName $TaskName
Write-Output "Started it now, so you do not need to log out."
Write-Output ""
Write-Output "Check it is working:"
Write-Output "  Get-Content `"$stateDir\watcher.log`" -Tail 20 -Wait"

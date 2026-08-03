# Schedule this script in Windows Task Scheduler (e.g. daily 02:00 IST).
# Action: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\database\fast-close-app\scripts\ops\arcp-nightly.ps1"
# Compat shim also at scripts\arcp-nightly.ps1 if the old scheduled path is still used.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

$logDir = Join-Path $PWD 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}
$logFile = Join-Path $logDir ("arcp-nightly-{0:yyyy-MM-dd}.log" -f (Get-Date))

function Write-Log([string]$Message) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

Write-Log 'Starting ARCP nightly incremental sync'
try {
  npm run sync-worker:arcp-nightly 2>&1 | ForEach-Object { Write-Log $_ }
  Write-Log 'ARCP nightly finished OK'
  exit 0
} catch {
  Write-Log "ARCP nightly failed: $_"
  exit 1
}

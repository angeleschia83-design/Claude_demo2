<# Stops the register and removes the scheduled task. Leaves the database,
   the logs and the folder alone. #>
[CmdletBinding()]
param([string] $TaskName = 'Device register')

$ErrorActionPreference = 'Stop'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed the scheduled task: $TaskName" -ForegroundColor Green
} else {
  Write-Host "No scheduled task named $TaskName. Nothing to remove."
}
Write-Host 'register.db and logs\ were left where they are.'

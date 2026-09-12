$ErrorActionPreference = "Stop"

$launcher = Join-Path $PSScriptRoot "qwensofia-local-account-browser.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $launcher + '"')
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName "QwenSofia Local Account Browser" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "QwenSofia Local Account Browser"

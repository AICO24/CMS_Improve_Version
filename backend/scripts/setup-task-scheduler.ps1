<#
.SYNOPSIS
Registers or removes the Windows Task Scheduler task for CMS Automation Sweeps.
.DESCRIPTION
Sets up an hourly scheduled task that executes backend/scripts/run-automation-sweeps.php
using Laragon's PHP runtime.
.EXAMPLE
powershell -ExecutionPolicy Bypass -File backend\scripts\setup-task-scheduler.ps1 -Action install
powershell -ExecutionPolicy Bypass -File backend\scripts\setup-task-scheduler.ps1 -Action uninstall
#>

param(
    [ValidateSet("install", "uninstall", "remove")]
    [string]$Action = "install"
)

$TaskName = "CMS_Automation_Sweeps"
$PhpPath = "C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe"
$WorkingDir = (Resolve-Path "$PSScriptRoot\..\..").Path
$ScriptRelPath = "backend\scripts\run-automation-sweeps.php"

if ($Action -in @("uninstall", "remove")) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "[OK] Task '$TaskName' has been removed." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $PhpPath)) {
    $resolvedPhp = (Get-Command php -ErrorAction SilentlyContinue).Source
    if ($resolvedPhp) {
        $PhpPath = $resolvedPhp
    } else {
        Write-Warning "PHP binary not found at $PhpPath or in PATH."
    }
}

try {
    $taskAction = New-ScheduledTaskAction -Execute $PhpPath -Argument $ScriptRelPath -WorkingDirectory $WorkingDir
    $taskTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
    $taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    Register-ScheduledTask -TaskName $TaskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description "Runs Cemetery Management System reservation and lease expiration sweeps hourly" -Force

    Write-Host "[SUCCESS] Task '$TaskName' successfully registered to run hourly." -ForegroundColor Green
    Write-Host "Action: $PhpPath $ScriptRelPath" -ForegroundColor Cyan
    Write-Host "Working Directory: $WorkingDir" -ForegroundColor Cyan
} catch {
    Write-Host "[NOTICE] To register this task with Windows Task Scheduler, please run PowerShell as Administrator:" -ForegroundColor Yellow
    Write-Host "powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\setup-task-scheduler.ps1`"" -ForegroundColor White
}

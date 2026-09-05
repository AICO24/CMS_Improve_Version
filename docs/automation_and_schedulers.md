# Automation Sweeps & Scheduled Tasks

## Overview
The Cemetery Management System features background automation sweeps designed to run on a recurring schedule via CLI. These sweeps handle time-dependent business policies:

1. **Stale Reservation Lifecycle (Burial & Cremation):**
   - **Stage 1 (Reminder):** Sent 7 days after creation if status is `Pending` and no payments have been attempted (`stale_notified_at`).
   - **Stage 2 (Final Warning):** Sent 4 days after Stage 1 reminder was sent (`final_warning_notified_at`).
   - **Stage 3 (Auto-Cancellation):** Automatically cancels reservation 3 days after Stage 2 warning was sent.
   - *Design Guarantee:* Stages are strictly chained to the previous stage's recorded timestamp rather than calendar age alone. If a scheduled sweep is delayed or missed, it will never execute all three stages simultaneously.
2. **Unlinked Decedent Watchdog:**
   - Detects `Confirmed` burial schedules whose scheduled burial date has passed with no linked `decedent_records` entry, raising staff notifications.
3. **5-Year Lease Expiration Warnings:**
   - Scans `expiration_records` for upcoming lease lapses within the 30-day window, generating staff notifications with deduplication.
4. **Lot Expiration Sync:**
   - Evaluates occupied lots whose latest expiration record has lapsed without renewal (`renewed = 'no'`), transitioning lot status from `Occupied` to `Expired` via `AutomationEngine`.

---

## Runner Script: `backend/scripts/run-automation-sweeps.php`

### Architecture & Safety
- **CLI Guard:** The script enforces `PHP_SAPI === 'cli'`. It cannot be triggered via HTTP/web requests, preventing unauthorized execution.
- **Stage Isolation:** Each sweep stage executes within an isolated `try/catch` closure. A failure or timeout in one stage will not prevent subsequent stages from running.
- **Persistent Logging:** Outputs execution logs to STDOUT and appends timestamped records to `backend/storage/logs/automation-sweeps.log`.

### Manual CLI Execution
From the project root:
```bash
# Using system PHP:
php backend/scripts/run-automation-sweeps.php

# Using Laragon PHP (Windows):
C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe backend/scripts/run-automation-sweeps.php
```

Example Output:
```text
[2026-09-05 09:41:38] === automation sweep run started ===
[2026-09-05 09:41:38] expiration-records/generate-notifications: 0 expiration notifications generated
[2026-09-05 09:41:38] schedules/notify-stale-pending: 0 stale-reservation reminder(s) sent
[2026-09-05 09:41:38] schedules/send-final-warnings: 0 final warning(s) sent
[2026-09-05 09:41:38] schedules/auto-cancel-stale-pending: 0 stale reservation(s) automatically cancelled
[2026-09-05 09:41:38] schedules/flag-unlinked-decedent: Flagged 0 schedule(s) missing a decedent record
[2026-09-05 09:41:38] cremations/notify-stale-pending: 0 stale-cremation-request reminder(s) sent
[2026-09-05 09:41:38] cremations/send-final-warnings: 0 final warning(s) sent
[2026-09-05 09:41:38] cremations/auto-cancel-stale-pending: 0 stale cremation request(s) automatically cancelled
[2026-09-05 09:41:38] lots.expired-sync: lot expiration sync triggered
[2026-09-05 09:41:38] === automation sweep run finished ===
```

---

## Operating System Scheduler Configuration

### 1. Windows Task Scheduler (Recommended for Laragon / Windows Server)

#### Option A: PowerShell Command (Administrator)
Run PowerShell as Administrator to register the scheduled task to execute every hour:
```powershell
$phpPath = "C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe"
$workingDir = "C:\laragon\www\CMS"
$scriptPath = "backend\scripts\run-automation-sweeps.php"

$action = New-ScheduledTaskAction -Execute $phpPath -Argument $scriptPath -WorkingDirectory $workingDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([TimeSpan]::MaxValue)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName "CMS_Automation_Sweeps" -Action $action -Trigger $trigger -Principal $principal -Description "Executes CMS cemetery reservation and lease expiration sweeps hourly"
```

#### Option B: GUI Setup
1. Open **Task Scheduler** (`taskschd.msc`).
2. Click **Create Task** (not Basic Task).
3. Under **General**:
   - Name: `CMS_Automation_Sweeps`
   - Run whether user is logged on or not
4. Under **Triggers**:
   - New -> Begin the task: **On a schedule**
   - Daily -> Recur every 1 days.
   - Advanced settings: Check **Repeat task every 1 hour** for a duration of **Indefinitely**.
5. Under **Actions**:
   - Action: **Start a program**
   - Program/script: `C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe`
   - Add arguments: `backend\scripts\run-automation-sweeps.php`
   - Start in: `C:\laragon\www\CMS`
6. Click **OK** and save.

---

### 2. Linux Production (crontab / systemd)

#### Option A: Cron Configuration
Edit the crontab for the web/app user (e.g. `www-data` or `cms`):
```bash
crontab -e -u www-data
```
Add the following line to run at the top of every hour:
```cron
0 * * * * cd /var/www/CMS && /usr/bin/php backend/scripts/run-automation-sweeps.php >> /var/www/CMS/backend/storage/logs/cron.log 2>&1
```

#### Option B: systemd Service and Timer
Create `/etc/systemd/system/cms-sweeps.service`:
```ini
[Unit]
Description=Cemetery Management System Automation Sweeps
After=network.target mysql.service

[Service]
Type=oneshot
User=www-data
WorkingDirectory=/var/www/CMS
ExecStart=/usr/bin/php backend/scripts/run-automation-sweeps.php

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/cms-sweeps.timer`:
```ini
[Unit]
Description=Run CMS Automation Sweeps Hourly

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start the timer:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cms-sweeps.timer
```

---

## Troubleshooting & Maintenance
- **Log Location:** All sweep actions and caught stage exceptions are logged to:
  `backend/storage/logs/automation-sweeps.log`
- **Database Exceptions:** Any transition rejected by lifecycle guards is recorded in the `system_exceptions` table and surfaced on the administrative System Exceptions dashboard (`frontend/views/admin/exceptions.html`).


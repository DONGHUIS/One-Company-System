# 로그온 시 PM2 프로세스를 복구하는 작업 스케줄러 항목을 등록한다.
#
#   등록 : npm run pm2:autostart
#   해제 : npm run pm2:autostart:remove
#   확인 : schtasks /query /tn "PM2 memo-server"
#
# 관리자 권한이 없어도 현재 사용자 계정의 작업으로 등록된다.
# 대신 "로그온 시"에만 동작한다 — 아무도 로그인하지 않은 부팅 직후에는 뜨지 않는다.
# 무인 서버로 쓰려면 관리자 권한으로 PM2 를 Windows 서비스로 등록해야 한다.

$ErrorActionPreference = "Stop"

$TaskName = "PM2 memo-server"
$Script = Join-Path $PSScriptRoot "..\pm2-resurrect.cmd" | Resolve-Path

if (-not (Test-Path $Script)) {
    throw "pm2-resurrect.cmd 를 찾을 수 없습니다: $Script"
}

$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute $Script.Path
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = "PT30S"   # 로그온 후 30초 대기 (MySQL 서비스 기동 여유)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "로그온 시 PM2 프로세스(memo-server)를 복구한다" `
    -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "등록 완료: '$TaskName' (상태: $($task.State))"
Write-Host "  실행 대상 : $($Script.Path)"
Write-Host "  계정      : $user"
Write-Host "  트리거    : 로그온 후 30초"
Write-Host ""
Write-Host "즉시 시험하려면: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "로그 확인      : logs\pm2-resurrect.log"

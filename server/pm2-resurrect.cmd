@echo off
REM ---------------------------------------------------------------
REM  Restores the saved PM2 process list at logon.
REM  Run by the Windows Task Scheduler task "PM2 memo-server".
REM
REM  NOTE: keep this file ASCII-only. cmd.exe reads .cmd files in the
REM  OEM codepage (949 here), so UTF-8 Korean comments corrupt parsing.
REM
REM  register : npm run pm2:autostart
REM  remove   : schtasks /delete /tn "PM2 memo-server" /f
REM  inspect  : schtasks /query /tn "PM2 memo-server"
REM  log      : logs\pm2-resurrect.log
REM ---------------------------------------------------------------

setlocal

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "PM2_BIN=%~dp0node_modules\pm2\bin\pm2"
set "LOGDIR=%~dp0..\logs"
set "LOGFILE=%LOGDIR%\pm2-resurrect.log"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

cd /d "%~dp0"

echo [%date% %time%] resurrect start >> "%LOGFILE%"

REM Give the MySQL service time to come up after boot.
REM "timeout" fails with "Input redirection is not supported" when stdin is
REM redirected (which is how the Task Scheduler runs us), so use ping instead.
ping -n 21 127.0.0.1 > nul

"%NODE_EXE%" "%PM2_BIN%" resurrect >> "%LOGFILE%" 2>&1
set "RC=%ERRORLEVEL%"

echo [%date% %time%] resurrect finished with exit code %RC% >> "%LOGFILE%"

endlocal & exit /b %RC%

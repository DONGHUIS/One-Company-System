@echo off
rem 스마트택배 로그인 문의 자동 초안 — Windows 작업 스케줄러용 래퍼
rem 서버(pm2) 없이 단독 실행. 실행 결과는 logs\sweettracker-task.log 에 기록된다.
cd /d "%~dp0.."
echo [%date% %time%] 실행 시작 >> "%~dp0..\..\logs\sweettracker-task.log"
"C:\Program Files\nodejs\node.exe" scripts\run-sweettracker-draft.js >> "%~dp0..\..\logs\sweettracker-task.log" 2>&1

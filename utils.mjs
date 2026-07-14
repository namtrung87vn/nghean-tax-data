@echo off
setlocal
cd /d "%~dp0\.."

echo =====================================================
echo  CAP NHAT DU LIEU THUE NGHE AN TU MAY WINDOWS
ECHO =====================================================

where node >nul 2>nul || (
  echo Khong tim thay Node.js. Hay cai Node.js 22 LTS.
  pause
  exit /b 1
)
where git >nul 2>nul || (
  echo Khong tim thay Git. Hay cai Git hoac GitHub Desktop.
  pause
  exit /b 1
)

call npm ci
if errorlevel 1 goto :fail

set READER_ENABLED=false
set REQUEST_TIMEOUT_MS=30000
set REQUEST_RETRIES=2
set MAX_NEWS_PAGES=30
set MAX_DOC_PAGES=100

call npm run collect:full
if errorlevel 1 echo Mot so nguon loi; du lieu cu van duoc giu.
call npm run validate
if errorlevel 1 goto :fail

git add docs
for /f %%i in ('git diff --cached --name-only') do set HAS_CHANGES=1
if not defined HAS_CHANGES (
  echo Khong co thay doi de day len GitHub.
  pause
  exit /b 0
)

git commit -m "data: cap nhat tu may Windows"
if errorlevel 1 goto :fail
git pull --rebase origin main
if errorlevel 1 goto :fail
git push origin main
if errorlevel 1 goto :fail

echo Cap nhat va day len GitHub thanh cong.
pause
exit /b 0

:fail
echo Cap nhat that bai. Xem thong bao phia tren.
pause
exit /b 1

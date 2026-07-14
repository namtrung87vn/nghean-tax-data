@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."
call npm ci || goto :error
call npm install --no-save --no-package-lock playwright@1.61.1 || goto :error
call npx playwright install chromium || goto :error
set BROWSER_ENABLED=true
set BROWSER_TIMEOUT_MS=120000
set BROWSER_SETTLE_MS=3000
set MAX_BROWSER_NEWS_PAGES=50
set CACHE_IMAGES=true
set MAX_CACHED_IMAGES=200
set READER_ENABLED=false
call npm run collect:news || goto :error
call npm run validate || goto :error
git add docs
git diff --cached --quiet
if not errorlevel 1 goto :done
git commit -m "data: cap nhat tin tu may Windows bang Chromium" || goto :error
git pull --rebase origin main || goto :error
git push origin main || goto :error
:done
echo Cap nhat tin hoan tat.
pause
exit /b 0
:error
echo Cap nhat that bai.
pause
exit /b 1

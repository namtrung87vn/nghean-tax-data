@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."

echo =====================================================
echo CAP NHAT DU LIEU THUE NGHE AN BANG CHROMIUM TREN MAY NAY
echo =====================================================

echo [1/5] Cai cac goi project...
call npm ci
if errorlevel 1 goto :error

echo [2/5] Cai Playwright 1.61.1...
call npm install --no-save --no-package-lock playwright@1.61.1
if errorlevel 1 goto :error

echo [3/5] Cai Chromium neu chua co...
call npx playwright install chromium
if errorlevel 1 goto :error

echo [4/5] Lay toan bo du lieu va thumbnail...
set BROWSER_ENABLED=true
set BROWSER_TIMEOUT_MS=120000
set BROWSER_SETTLE_MS=3000
set MAX_BROWSER_NEWS_PAGES=50
set MAX_BROWSER_DOC_PAGES=120
set CACHE_IMAGES=true
set MAX_CACHED_IMAGES=200
set READER_ENABLED=false
call npm run collect:full
if errorlevel 1 goto :error

echo [5/5] Kiem tra va day len GitHub...
call npm run validate
if errorlevel 1 goto :error

git add docs
git diff --cached --quiet
if not errorlevel 1 (
  echo Khong co du lieu moi de commit.
  goto :done
)
git commit -m "data: cap nhat tu may Windows bang Chromium"
if errorlevel 1 goto :error
git pull --rebase origin main
if errorlevel 1 goto :error
git push origin main
if errorlevel 1 goto :error

goto :done

:error
echo.
echo CAP NHAT THAT BAI. Hay chup man hinh loi va gui lai.
pause
exit /b 1

:done
echo.
echo CAP NHAT HOAN TAT.
echo Mo: https://namtrung87vn.github.io/nghean-tax-data/
pause
endlocal

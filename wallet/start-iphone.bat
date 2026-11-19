@echo off
rem Runs LOKYX Wallet on your iPhone through the Expo Go app.
rem Needs Node.js from nodejs.org, and Expo Go from the App Store on the iPhone.
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js first: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing, this takes a few minutes the first time...
  call npm install || (pause & exit /b 1)
)
echo.
echo Log in with your Expo account. Use the same account in the Expo Go app on the iPhone.
call npx expo login
echo.
echo When the QR code appears, scan it with the iPhone camera.
call npx expo start --tunnel
pause

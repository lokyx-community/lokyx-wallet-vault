@echo off
setlocal
cd /d "%~dp0"
title LOKYX miner
set NET=testnet

set ADDR=
for /f "delims=" %%a in ('lokyx-wallet.exe --network %NET% address 2^>nul') do set ADDR=%%a
if not "%ADDR%"=="" goto mine

echo.
echo  You don't have a LOKYX wallet on this computer yet, so let's make one.
echo  It will ask for a password, then show 24 words. Write the words on paper:
echo  they are the only way to get your coins back if this computer breaks.
echo.
lokyx-wallet.exe --network %NET% new
if errorlevel 1 goto fail
for /f "delims=" %%a in ('lokyx-wallet.exe --network %NET% address') do set ADDR=%%a
echo.
pause

:mine
set /a THREADS=%NUMBER_OF_PROCESSORS% / 2
if %THREADS% LSS 1 set THREADS=1
echo.
echo  Mining to %ADDR% with %THREADS% threads.
echo  The first start takes a minute while it downloads the chain.
echo  Leave this window open while you mine. Close it to stop.
echo  Watch it at https://testnet.lokyx.xyz/#/mining  Your wallet: double-click lokyx-wallet.exe
echo.
lokyxd.exe --network %NET% --mine --coinbase %ADDR% --threads %THREADS% --rpc-cors https://testnet.lokyx.xyz
echo.
echo  The node stopped.
pause
exit /b 0

:fail
echo  Making the wallet didn't work. Nothing was mined.
pause
exit /b 1

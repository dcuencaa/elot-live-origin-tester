@echo off
echo Starting MSL5 Tester...

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed. 
    echo Please install it from https://nodejs.org/
    pause
    exit /b
)

:: Install dependencies
echo Checking and installing dependencies...
call npm install

:: Start the server in a new command window
echo Starting local Node.js server...
start "MSL5 Server" cmd /c "npm start"

:: Wait 3 seconds for server to boot
timeout /t 3 /nobreak >nul

:: Open default browser
echo Launching User Interface...
start http://localhost:3000
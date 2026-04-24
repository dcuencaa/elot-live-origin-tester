#!/bin/bash
echo "Starting MSL5 Tester..."

# Check for Node.js
if ! command -v node &> /dev/null
then
    echo "Error: Node.js is not installed."
    echo "Please download it from https://nodejs.org/ or run: brew install node"
    exit 1
fi

# Install dependencies (including the static FFmpeg binary)
echo "Checking dependencies..."
npm install

# Start the Node.js server in the background
echo "Starting local Node.js server..."
npm start &
SERVER_PID=$!

# Wait 2 seconds for the server to boot up
sleep 2

# Open the browser to the local app
echo "Launching User Interface..."
if which xdg-open > /dev/null; then
  xdg-open http://localhost:3000
elif which open > /dev/null; then
  open http://localhost:3000
fi

# Keep terminal open and cleanly kill server on exit
trap "kill $SERVER_PID" EXIT
wait $SERVER_PID
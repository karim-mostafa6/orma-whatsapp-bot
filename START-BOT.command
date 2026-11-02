#!/bin/bash
# Mac: double-click this file to start the bot.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from the page that opened, install it, then run this again."
  open https://nodejs.org/
  read -r -p "Press Enter to close..."
  exit 1
fi
if [ ! -d node_modules/@whiskeysockets/baileys ]; then
  echo "First run: downloading what the bot needs (one time only)..."
  npm install --omit=dev --no-audit --no-fund || { read -r -p "Download failed. Check the internet and try again. Press Enter..."; exit 1; }
fi
echo "KEEP THIS WINDOW OPEN. If you close it, the bot stops replying."
while true; do
  node src/index.js
  echo "The bot stopped. Restarting in 5 seconds (close this window to stop it)..."
  sleep 5
done

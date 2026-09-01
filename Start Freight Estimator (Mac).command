#!/bin/bash
# Double-click this file to set up and start the Freight Estimator.
# It is safe to run again any time - it only does the setup steps once.

cd "$(dirname "$0")" || exit 1

echo
echo "  Semcom Freight Estimator"
echo "  ========================"
echo

# Homebrew and the Node installer put node in places a double-clicked script
# does not always see, so look there too before giving up.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

if [ ! -f package.json ]; then
  echo "  This folder does not contain the application."
  echo
  echo "  You are probably on the empty \"main\" branch. In Terminal here, run:"
  echo
  echo "    git checkout claude/freight-estimate-container-tool-ryc7mq"
  echo
  echo "  then double-click this file again."
  echo
  read -r -p "  Press Enter to close..."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed on this computer."
  echo
  echo "  I will open the download page. Install the version marked \"LTS\""
  echo "  accept all the defaults, then double-click this file again."
  echo
  read -r -p "  Press Enter to continue..."
  open https://nodejs.org
  exit 1
fi

fail() {
  echo
  echo "  Something went wrong above. Send the message to whoever set this up."
  echo
  read -r -p "  Press Enter to close..."
  exit 1
}

if [ ! -d node_modules ]; then
  echo "  First-time setup. This takes a few minutes - leave it running."
  echo
  npm install || fail
fi

if [ ! -f .env ]; then
  echo
  echo "  Creating your admin login..."
  echo
  npm run setup || fail
  echo
  echo "  >>> WRITE THE PASSWORD ABOVE DOWN NOW. It is not shown again. <<<"
  echo
  read -r -p "  Press Enter to continue..."
fi

if [ ! -f web/dist/index.html ]; then
  echo "  Preparing the application..."
  npm run build || fail
fi

echo
npm start

echo
echo "  The Freight Estimator has stopped."
read -r -p "  Press Enter to close..."

#!/bin/bash
# Double-click to fetch the latest version and start it.
# Stop the tool first if it is running (Ctrl+C in its window).

cd "$(dirname "$0")" || exit 1
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

echo
echo "  Updating the Freight Estimator"
echo "  =============================="
echo

fail() {
  echo
  echo "  Something went wrong above. Send the message to whoever set this up."
  echo
  read -r -p "  Press Enter to close..."
  exit 1
}

if ! command -v git >/dev/null 2>&1; then
  echo "  Git is not installed, so this cannot fetch updates."
  read -r -p "  Press Enter to close..."
  exit 1
fi

# A failed install can leave package-lock.json modified, which blocks the pull.
# It is a generated file, so the published one always wins.
git checkout -- package-lock.json >/dev/null 2>&1

echo "  Fetching the latest version..."
git pull || fail

echo
echo "  Installing any new components..."
npm install || fail

echo
echo "  Rebuilding..."
npm run build || fail

echo
echo "  Up to date. Starting..."
echo
npm start

echo
echo "  The Freight Estimator has stopped."
read -r -p "  Press Enter to close..."

#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "Python was not found. Please install Python 3.12+ and try again."
  exit 1
fi

if [ ! -d "venv" ]; then
  "$PYTHON_CMD" -m venv venv
fi

source venv/bin/activate
"$PYTHON_CMD" -m pip install -r requirements.txt
"$PYTHON_CMD" app.py

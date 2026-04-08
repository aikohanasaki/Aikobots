#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is not installed or not in PATH."
    exit 1
fi

if [ ! -f "$SCRIPT_DIR/server.js" ]; then
    echo "Error: server.js not found in $SCRIPT_DIR"
    exit 1
fi

cd "$SCRIPT_DIR"
export NODE_ENV="${NODE_ENV:-production}"

exec node "$SCRIPT_DIR/server.js" "$@"
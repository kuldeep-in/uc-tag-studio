#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f local.env ]; then
  echo "ERROR: local.env not found. Copy the template and fill in values." >&2
  exit 1
fi

set -a; source local.env; set +a

exec uvicorn app:app --reload --port 8000

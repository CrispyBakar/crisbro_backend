#!/usr/bin/env bash
# Run prisma migrate dev against the session-mode pooler (DIRECT_URL, port 5432).
# Running migrations through DATABASE_URL (transaction pooler, port 6543) leaves
# session-level advisory locks stuck on Supabase and causes P1002 timeouts.
set -euo pipefail
cd "$(dirname "$0")/.."

DIRECT_URL=$(grep '^DIRECT_URL=' .env | head -1 | cut -d'"' -f2)
if [ -z "$DIRECT_URL" ]; then
  echo "Error: DIRECT_URL not found in .env" >&2
  exit 1
fi

DATABASE_URL="$DIRECT_URL" npx prisma migrate dev "$@"

#!/bin/bash
# What a Claude Code cloud session needs to build, test and run the app, run by the SessionStart hook in
# .claude/settings.json. Outside the cloud it does nothing: CLAUDE_CODE_REMOTE is "true" only on the cloud VM.
# Fast when nothing changed: uv sync is a no-op on a synced environment, and npm ci is skipped while the lock file
# and this script are unchanged. Output goes to a log; the session gets one line saying what is ready.

if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0
log=/tmp/cloud_setup.log
: > "$log"
status=()

# backend: Python 3.11 (pyproject pins it; uv downloads it when the VM has another version), then the locked packages
if (cd backend && uv python install 3.11 && uv sync --frozen) >> "$log" 2>&1; then
  status+=("backend ready")
else
  status+=("backend install FAILED (cd backend && uv sync)")
fi

# frontend: the packages in the lock file, then a build, which the backend serves
stamp=frontend/node_modules/.cloud_setup.sha256
if ! sha256sum --check --status "$stamp" 2>/dev/null; then
  rm -f "$stamp" # a failed install runs again next time
  if (cd frontend && npm ci --no-audit --no-fund) >> "$log" 2>&1; then
    sha256sum scripts/cloud_setup.sh frontend/package.json frontend/package-lock.json > "$stamp" || rm -f "$stamp"
  fi
fi
if [ -f "$stamp" ]; then
  if [ -f frontend/dist/index.html ] || (cd frontend && npm run build) >> "$log" 2>&1; then
    status+=("frontend ready")
  else
    status+=("frontend build FAILED (cd frontend && npm run build)")
  fi
else
  status+=("frontend install FAILED (cd frontend && npm ci)")
fi

echo "Cloud setup: $(IFS=';'; echo "${status[*]}" | sed 's/;/, /g'). Log: $log. Checks: bash scripts/check.sh"
exit 0

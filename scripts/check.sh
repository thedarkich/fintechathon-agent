#!/bin/bash
# Everything that must pass before a commit, all offline and free: lint, the tests, the evaluation sets with the
# offline planner, and the frontend's type check and build.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== ruff"
(cd backend && uv run ruff check app tests)
echo "== tests"
(cd backend && uv run pytest -q)
echo "== evaluation sets (offline planner)"
(cd backend && uv run python -m app.evals ../evals/intent.jsonl ../evals/attacks.jsonl --out "${TMPDIR:-/tmp}/bank-agent-evals")
echo "== frontend type check and build"
build_log="${TMPDIR:-/tmp}/bank-agent-build.log"
# on a machine with nvm, its npm (under WSL the Windows npm can come first on PATH and cannot build here)
if [ -s "$HOME/.nvm/nvm.sh" ]; then set +u; . "$HOME/.nvm/nvm.sh" >/dev/null; set -u; fi
(cd frontend && npm run build > "$build_log" 2>&1) || { tail -n 30 "$build_log"; exit 1; }
tail -n 1 "$build_log"

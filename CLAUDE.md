@AGENTS.md

## Claude Code cloud sessions

- **Setup is automatic.** `.claude/settings.json` runs `scripts/cloud_setup.sh` when a session starts or resumes. In a
  cloud session (`CLAUDE_CODE_REMOTE=true`) it installs Python 3.11 and the backend's locked packages with uv, the
  frontend's npm packages, and builds the frontend; anywhere else it does nothing. Its log is `/tmp/cloud_setup.log`.
  If it reports a failure, run the step it names by hand to see why.
- **Before every commit:** `bash scripts/check.sh` (ruff, the tests, the offline evaluation sets, the frontend build).
  Every check is offline and free.
- **Run the app:** `cd backend && uv run uvicorn app.main:app --port 8000` serves the API and `frontend/dist`. Without an
  AI key the offline planner answers, and everything works. After changing `frontend/src`, run `npm run build` in
  `frontend` so the served app has the change.
- **The AI planner (Qwen) is opt-in and paid** (rule 5): it needs `LLM_ENABLED=true`, `AI_BASE_URL`, `AI_API_KEY`,
  `AI_MODEL` and `LLM_THINKING=false` in the environment, and the provider's host on the cloud environment's allowed
  domains. Never write a key into the repo, and ask before any run that calls it.
- **Docs and slides quote measured numbers** (tests, evaluation results). When a change moves one, update every place
  that states it: `git grep` for the old number.

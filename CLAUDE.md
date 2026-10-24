@AGENTS.md
@docs/STATUS.md

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
- **The AI planner (Qwen) is paid** (rule 5). It runs when the environment sets `LLM_ENABLED=true`, `AI_BASE_URL`,
  `AI_API_KEY`, `AI_MODEL` and `LLM_THINKING=false` (a cloud environment's variables, or a network secret for the key),
  and the provider's host is reachable. Then the running app plans with Qwen; the tests and `scripts/check.sh` never
  call it whatever the environment says. `cd backend && uv run python ../scripts/qwen_check.py` makes one call and
  says whether Qwen answered or why not. The key allows about 5 requests a minute, so don't run
  `python -m app.evals --model` with it (no pacing: most cases would hit the limit). Never write a key into the repo,
  and ask before any run that calls the model.
- **Slides and PDFs:** the decks' sources are in `submission/slides`; `submission/build_slides.py` and
  `submission/build_docs.py` print the submission PDFs (they need Chrome or Chromium; in a cloud session run them with
  `CHROME=/opt/pw-browsers/chromium`, Playwright's copy). See `submission/README.md`.
- **Docs and slides quote measured numbers** (tests, evaluation results). When a change moves one, update every place
  that states it: `git grep` for the old number.

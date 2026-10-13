# Instructions for coding agents

Read `docs/SPEC.md` first. It is the contract: the action list with tiers, the plan format, the audit format and the data model.

## Rules

1. **The model never decides.** It only proposes plans. Tiers, approvals, verification and every fact shown to the customer come from code. Never give the planner a way to set a tier, skip approval or see tool results.
2. **The tier thresholds match the brief exactly** (`backend/app/agent/policy.py`). Changing them needs the human's approval.
3. **Every money movement goes through `backend/app/bank/ledger.py`** and leaves a transaction row.
4. **Never commit secrets and never open them.** `.env` and `deploy/runtime.env` are git-ignored; learn variable names from `.env.example`.
5. **No unattended paid AI calls.** The tests use the offline planner or a fake model. Ask before any run that calls a real provider.
6. **No public CDNs or Google Fonts.** Judges and customers may be on mainland networks; bundle every asset.
7. **Every user-facing string exists in Chinese and English** (`tr(en, zh)` in the frontend, `ctx.t(zh, en)` in the backend).

## Commands

```bash
cd backend && uv sync && uv run pytest -q && uv run ruff check app tests
cd backend && uv run uvicorn app.main:app --reload --port 8000
cd frontend && npm ci && npm run dev        # proxies /api to :8000
cd frontend && npm run build                # dist/ is served by the backend
```

## Layout

```
backend/app/
  agent/        planner (model + offline), executor, policy, resolve, replies, audit, locks, screening, verify, scheduler
  agent/actions the action catalogue: queries, payments, cards, subscriptions, wealth, security
  bank/         seed (demo customer), ledger, transfers (how a transfer clears), analysis, categories
  api/          accounts, agent (chat, plans, verification), bank pages, demo tools, operator console
frontend/src/   pages (Landing, Auth, Assistant, Accounts, Transfers, Bills, Wealth, Controls, Ledger, Operator, TeamAccess), components (StepRow, Decision, PlanView, Verify, Results, Seal, SiteChrome)
deploy/         docker-compose.yml, Caddyfile, runtime.env.example
docs/SPEC.md    the design contract
```

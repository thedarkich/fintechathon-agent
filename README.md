# Banking AI Agent · 银行 AI 助手

Entry for the 2026 Shenzhen International FinTech Competition (FinTechathon), **Domestic AI Track: Banking AI Agent**.

**The AI only proposes. Fixed code decides what is allowed, and code (not the AI) states every fact.**

A customer says what they need in Chinese or English ("给妈妈转200", "冻结我的虚拟卡", "下个月老婆生日，帮我预留1000，提前两天订花和蛋糕"). The planner turns it into a plan: steps from a fixed catalogue of 38 bank actions, arranged as a dependency graph. Code then matches every name, card and merchant to the customer's own records, gives each step a permission tier, runs read-only steps at once, shows everything else on a confirmation slip and asks for strong verification when the rules require it. Every stage is written to a hash-chained audit log.

The design is in [docs/SPEC.md](docs/SPEC.md).

## Status (12 October 2026)

Working and tested:

- **Simulated bank** per customer: about 22 months of realistic transactions, payees (including two people who share a pinyin name), two cards, subscriptions and direct debits, wealth holdings, seeded anomalies, and a demo clock that moves time forward.
- **All six scenarios from the brief**: transfers (by name, relationship, phone or note; scheduled; split bills), bill analysis (categories, unusual transactions, monthly and annual reports), wealth (holdings and returns, comparison, suitability-checked recommendations, risk questionnaire, buy and redeem), card management (apply, limits, switches, freeze and unfreeze, loss report), subscriptions (detection from transactions, reminders, cancel), and cross-scenario orchestration (the birthday plan).
- **Permission tiers** exactly as in the brief, with the ¥1,000 daily rule counted across the day and checked again when a scheduled step runs. Risk signals can only raise a tier.
- **Strong verification**: 6-digit PIN plus an SMS code (simulated phone) or a passkey (WebAuthn).
- **Security**: injection screening, a strict plan schema the model cannot extend, no tool output ever reaching the model, approval bound to a hash of the exact details, safety locks, typed secrets hidden, replies written only by code.
- **Planning**: dependency graph, clarification questions with choices built by code, stop, undo (compensation), edit, and human takeover through an operator console.
- **Planner**: an offline Chinese/English planner (no key needed, used by the tests) and an OpenAI-compatible model planner with validation and fallback.
- **Frontend**: bilingual (中文 / English) web app, light and dark: landing, sign-in, Assistant (conversation + the 审批栏 sign-off row for each plan), Accounts, Bills, Wealth, Cards & controls (safety lock, passkeys, simulated phone, demo clock), Ledger (hash-chained audit) and an operator console. See [frontend/README.md](frontend/README.md).

Not built yet: reading receipt photos, the code sandbox for open-ended analysis questions, voice input, an IM channel, the submission documents. The AI provider has not been chosen, so the model planner has only been tested with a fake model.

## Run it locally

Requirements: Python 3.11 with [uv](https://docs.astral.sh/uv/), Node.js 20.

```bash
cd frontend && npm ci && npm run build
cd ../backend && uv sync
uv run uvicorn app.main:app --port 8000
```

Open http://localhost:8000, choose **Open a demo account**, and pick any 6-digit PIN that isn't repeated or sequential. No AI key is needed: without one, the offline planner answers.

For frontend work, run `npm run dev` in `frontend/` as well (Vite proxies `/api` to port 8000).

To use a model, set `LLM_ENABLED=true`, `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` in `.env` (see [.env.example](.env.example)). Any OpenAI-compatible chat endpoint that supports JSON output works.

## Tests

```bash
cd backend && uv run pytest -q
```

The suite runs every scenario through the HTTP API with the offline planner, plus the model planner with a fake model. It covers the tier boundaries, approval hashes, verification, the safety lock, rollback, scheduling and the audit chain.

## Deploy

One VPS with Docker Compose and Caddy (automatic HTTPS). Copy `deploy/runtime.env.example` to `deploy/runtime.env`, fill it in, then:

```bash
cd deploy && DOMAIN=bank.example.org docker compose up -d --build
```

Passkeys need HTTPS and `PASSKEY_RP_ID` equal to the public host name. Give an account operator access with `docker compose exec api python -m app.ops make-operator someone@example.com`.

## Licence

MIT. See [LICENSE](LICENSE).

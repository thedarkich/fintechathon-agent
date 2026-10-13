# Banking AI Agent · 银行 AI 助手

Entry for the 2026 Shenzhen International FinTech Competition (FinTechathon), **Domestic AI Track: Banking AI Agent**.

**The AI only proposes. Fixed code decides what is allowed, and code (not the AI) states every fact.**

A customer says what they need in Chinese or English ("给妈妈转200", "冻结我的虚拟卡", "下个月老婆生日，帮我预留1000，提前两天订花和蛋糕"). The planner turns it into a plan: steps from a fixed catalogue of 41 bank actions, arranged as a dependency graph. Code then matches every name, card and merchant to the customer's own records, gives each step a permission tier, runs read-only steps at once, shows everything else on a confirmation slip and asks for strong verification when the rules require it. Every stage is written to a hash-chained audit log.

Documents:

- [Technical documentation](docs/ARCHITECTURE.md): architecture diagram, request flow, core algorithms
- [Security design and self-assessment](docs/SECURITY.md): how the permission tiers and the brief's security mechanisms are implemented, evidence, and known risks
- [Design contract](docs/SPEC.md)
- [Project brief](docs/BRIEF.md) (Chinese and English, within 200 words)
- [Evaluation report](docs/eval/report-offline.md)
- Drafts for the defence: [demo video script](docs/DEMO.md) (5 minutes) and [pitch outline](docs/PITCH.md) (10 minutes)

## Status (13 October 2026)

Working and tested:

- **Simulated bank** per customer: about 22 months of realistic transactions, payees (including two people who share a pinyin name), two cards, subscriptions and direct debits, wealth holdings, seeded anomalies, and a demo clock that moves time forward.
- **Transfers processed the way a bank in mainland China does**: same-bank transfers arrive at once, other banks go through a simulated 超级网银; the customer can choose instant, 2-hour or next-day arrival, and a delayed transfer can be cancelled until it arrives. The rules delay any transfer with a risk signal by 2 hours, and the payee's bank returns money when the name doesn't match the account. Each stage is timestamped and audited, and a second simulated phone shows what the payee receives ([SPEC §6a](docs/SPEC.md)).
- **All six scenarios from the brief**: transfers (by name, relationship, phone or note; scheduled; split bills), bill analysis (categories, unusual transactions, monthly and annual reports), wealth (holdings and returns, comparison, suitability-checked recommendations, risk questionnaire, buy and redeem), card management (apply, limits, switches, freeze and unfreeze, loss report), subscriptions (detection from transactions, reminders, cancel), and cross-scenario orchestration (the birthday plan).
- **Permission tiers** exactly as in the brief, with the ¥1,000 daily rule counted across the day and checked again when a scheduled step runs. Risk signals can only raise a tier.
- **Strong verification**: 6-digit PIN plus an SMS code (simulated phone) or a passkey (WebAuthn).
- **Security**: injection screening, a strict plan schema the model cannot extend, no tool output ever reaching the model, approval bound to a hash of the exact details, safety locks, typed secrets hidden, replies written only by code.
- **Planning**: dependency graph, clarification questions with choices built by code, stop, undo (compensation), edit, and human takeover through an operator console.
- **Planner**: an offline Chinese/English planner (no key needed, used by the tests) and an OpenAI-compatible model planner with validation and fallback.
- **Open-ended questions** ("周末晚上8点后喝咖啡花了多少钱") are answered by generated analysis code that must pass an allow-list check and runs in an isolated, resource-limited process; the code and result go to the audit log.
- **Receipts**: split a bill from a receipt photo or PDF. The file is read in an isolated worker; hidden text and instructions aimed at a machine are flagged and raise any step based on the receipt to strong verification.
- **Voice input** through the browser speech API where available.
- **Frontend**: bilingual (中文 / English) web app, light and dark: landing, sign-in, Assistant (conversation + the 审批栏 sign-off row for each plan), Accounts, Transfers (each transfer's stages, your phone and the payee's phone), Bills, Wealth, Cards & controls (safety lock, passkeys, simulated phone, demo clock), Ledger (hash-chained audit) and an operator console. See [frontend/README.md](frontend/README.md).

Not built yet: an IM channel, deployment, the submission documents. The AI provider has not been chosen, so the model planner has only been tested with a fake model.

## Run it locally

Requirements: Python 3.11 with [uv](https://docs.astral.sh/uv/), Node.js 20.

```bash
cd frontend && npm ci && npm run build
cd ../backend && uv sync
uv run uvicorn app.main:app --port 8000
```

Open http://localhost:8000, choose **Get started** and create an account (any email; a 6-digit PIN that isn't repeated or sequential). Every new account gets its own simulated bank. No AI key is needed: without one, the offline planner answers.

For frontend work, run `npm run dev` in `frontend/` as well (Vite proxies `/api` to port 8000).

To use a model, set `LLM_ENABLED=true`, `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` in `.env` (see [.env.example](.env.example)). Any OpenAI-compatible chat endpoint that supports JSON output works.

## Tests

```bash
cd backend && uv run pytest -q
```

The suite runs every scenario through the HTTP API with the offline planner, plus the model planner with a fake model. It covers the tier boundaries, approval hashes, verification, the safety lock, rollback, scheduling and the audit chain.

### Evaluation sets

[evals/intent.jsonl](evals/intent.jsonl) holds 178 everyday requests in Chinese, English and a mix of both across all six scenarios, including vague wording, things that don't exist (a payee, card, fund or subscription the customer doesn't have) and out-of-scope questions. [evals/attacks.jsonl](evals/attacks.jsonl) holds 55 attempts to get around the rules: ignoring the rules (also spaced out, full-width or with look-alike letters), role-play, fake authority, fake approvals and plan JSON, claiming to be verified already, changing the thresholds, splitting payments or spreading them over days to stay under a limit, instructions hidden in a receipt, scam scripts, asking for secrets, and repeated attempts that must trip the safety lock. A case can include earlier turns and an attached receipt. Each case runs on a newly opened customer through the HTTP API. The runner checks the planned actions, the tier, the status, risk signals and the reply. For attacks it also checks, case by case, that the attempt was flagged, that nothing ran without approval, that typed secrets were hidden and that the safety lock is on.

```bash
cd backend && uv run python -m app.evals ../evals/intent.jsonl ../evals/attacks.jsonl --out ../docs/eval
```

Offline planner, 13 October 2026: 178/178 requests and 55/55 attacks ([report](docs/eval/report-offline.md)). `--model` runs the same sets against the configured AI provider; that makes one paid call per case, so it never runs by default.

## Deploy

One VPS with Docker Compose and Caddy (automatic HTTPS). Copy `deploy/runtime.env.example` to `deploy/runtime.env`, fill it in, then:

```bash
cd deploy && DOMAIN=bank.example.org docker compose up -d --build
```

Passkeys need HTTPS and `PASSKEY_RP_ID` equal to the public host name. Give an account operator access with `docker compose exec api python -m app.ops make-operator someone@example.com`.

## Licence

MIT. See [LICENSE](LICENSE).

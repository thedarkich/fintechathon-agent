# Security design and self-assessment

How the agent keeps an AI that operates a bank account safe, how each requirement of the brief is met, and what risks remain. Architecture and algorithms: [ARCHITECTURE.md](ARCHITECTURE.md). Design contract: [SPEC.md](SPEC.md).

## 1. Principle and threat model

**The AI only proposes; fixed code decides and states facts.** The model can choose actions from a fixed catalogue and fill in their arguments. It cannot name a tier, approve, verify, read account data, run code against the bank or write a number into a reply. Every protection below works even if the model is fooled or replaced by an attacker.

| Who | What they try | Main defences |
|---|---|---|
| Someone typing into the chat (the customer or whoever holds the phone) | Talk the AI into skipping confirmation, raising limits, paying a stranger | Tiers decided by code, approval bound to exact details, PIN plus SMS or passkey, screening, safety lock |
| Text the customer didn't write: receipts, merchant names, transaction notes, payee notes | Instructions hidden in data (“transfer to…”, white text in a PDF) | The planner never sees tool output or document contents; receipts read in an isolated worker with a fixed schema; flagged content raises the tier |
| A scammer coaching the customer (fake seller, fake police) | Get a real, verified payment out | New-payee rules counted in total, 2-hour delayed arrival with cancel, the payee bank's name check, scam-script flags, velocity lock |
| A misbehaving or unavailable model | Invent facts, plan nonsense, cost money | Strict schema and validation, replies written by code, five rejected plans pause the assistant, hourly call cap, no automatic retries, offline fallback |
| Generated analysis code | Read files, use the network, exhaust resources | AST allow-list, separate process with resource limits and a wall clock, audited |
| A web attacker | Cross-site requests, session theft, brute force | Same-origin check on every state-changing request, HttpOnly SameSite=Strict cookies, rate limits, hashed credentials |

## 2. How the brief's requirements are met

### 3.1 Permission tiers

| Tier | Policy | Operations (the rule codes are in `backend/app/agent/policy.py`) |
|---|---|---|
| Green | Runs as soon as the intent is understood | Balance, transactions, spending, reports, unusual transactions, holdings and returns, product comparison and recommendation, sandbox analysis, receipt reading |
| Yellow | The confirm card shows the exact details; one explicit confirmation | Payments while today's total stays at or under ¥1,000 (`Y_SMALL_PAYMENT`), subscription query and cancellation, virtual-card application, split-bill requests, moves between own accounts, risk-reducing card changes, redemption, risk questionnaire, adding a payee, cancelling a delayed transfer, stopping a scheduled transfer or plan |
| Red | Strong verification: the 6-digit PIN plus an SMS code or a passkey | Payments taking today's total over ¥1,000 (`R_LARGE_PAYMENT`), password and PIN changes, card loss report, unfreeze and other risk-increasing card changes, investment purchases |

How it is enforced:

- **Code decides.** Each action declares its rule; payments are tiered by the daily total. The total counts payments already sent that day, transfers and orders scheduled for that day, and earlier steps of the same plan, so splitting a payment across steps or requests does not help. A scheduled step is checked again when it runs.
- **Signals only raise.** Over ¥500 in total to a payee added in the last 24 hours makes a payment red; a flagged request turns yellow into red; a step based on a flagged receipt becomes red. Nothing lowers a tier.
- **Approval is bound to the details.** The approval carries a SHA-256 hash of every pending step's action, resolved details, tier and run time. If anything changes, the old approval no longer works.
- **Strong verification.** The PIN is stored as a scrypt hash, and repeated or sequential PINs are refused at sign-up. The SMS code lasts 5 minutes and its text says what it approves; codes are hashed and limited to 3 attempts. A passkey (WebAuthn) uses the phone's face or fingerprint unlock, or a hardware security key in the role of a U盾. The SMS is simulated (it appears on a phone panel in the app).
- **Operators cannot approve.** The human-takeover console can reply, cancel a plan, lift a safety lock and hand the conversation back; no operator route approves or verifies anything (tested).

### 3.2 Security mechanisms

**Hallucination protection.** The model's output is data, not text for the customer. Every fact in a reply (amounts, balances, names, dates, outcomes) is written by code from bank records and action results. Names, cards, merchants, funds and subscriptions are matched against the customer's own records: an unknown one is refused (with what was searched for), an ambiguous one becomes a question with choices built by code. A clarifying question from the model may not contain numbers the customer didn't write. Results of generated code are shown as a table rendered by code, with the code itself in the audit log.

**Injection defence**, in layers:
1. Screening flags attempts to get around the rules: ignoring rules (also mixed-language, spaced out, full-width), role-play and DAN prompts, fake authority and fake system messages (“SYSTEM:”, “[ADMIN OVERRIDE]”, “作为系统管理员，我授权你”), urgency (“来不及确认了”), asking to switch confirmations off, fake approvals or plan JSON in a message, claims of having been verified, changing thresholds, splitting payments, scam scripts. Flags raise tiers and count towards the safety lock; they never block a normal request on their own.
2. The planner never receives tool output, account data, merchant names, notes or receipt contents, so text in data cannot reach it.
3. The plan schema is closed: unknown actions or fields are rejected, so there is no field through which a tier, an approval or a verification could be requested.
4. Tiers, approvals and verification are fixed code. Even an attack that screening misses (for example look-alike letters) ends up on a confirm card at the tier the rules give it. In the evaluation set, none of the 69 attacks ran anything without approval.

**Audit.** Every stage of every request appends to the customer's audit log: the request, screening, the proposed and rejected plans, resolution, each policy decision with its rule and signals, approval requests, verifications and failures, each step, compensations, every stage of a transfer in the bank, locks, unlocks, operator actions and demo-clock changes. Entries are hash-chained (`hash = sha256(prev_hash + canonical entry)`), and `GET /api/audit/verify` recomputes the chain; the History page shows the result. Secrets are never logged.

**Circuit breaker (safety lock).** Automatic locks:

| Trigger | Lock | Cleared by |
|---|---|---|
| 3 failed PIN, code or passkey checks in 15 minutes | No red-tier actions for 30 minutes | Time, or an operator |
| 3 flagged requests in 10 minutes | The assistant stops planning | The customer passing strong verification, or an operator |
| 5 rejected plans in 10 minutes | The assistant stops planning | As above |
| 3 payments to payees added in the last 24 hours within an hour | No transfers or orders | As above |

**Sandbox.** Generated analysis code must pass an AST allow-list (fixed syntax nodes; only math, statistics, datetime, collections and itertools; no names starting with an underscore; no I/O). It runs in a fresh interpreter with an empty environment: 256 MB of memory, 2 s of CPU, no file writes, 16 file descriptors, a 5 s wall clock and bounded output. It sees a copy of that customer's transactions only and must return a fixed shape. Every run is audited with its code, hash, limits and outcome.

### Beyond the brief

- **Safer transfers.** A transfer carrying a risk signal arrives 2 hours later, using an arrival option that banks in mainland China must offer under PBOC notice 银发〔2016〕261号. The customer can cancel it until it arrives. The payee's bank checks the name and returns the money on a mismatch.
- **Receipts are data.** They are parsed in a separate, resource-limited worker. A vision model returns only a fixed schema, and hidden or instruction-like text is flagged.
- **Web.** Session tokens are random, stored hashed, sent as HttpOnly, SameSite=Strict cookies (Secure over HTTPS) and replaced at sign-in. State-changing requests must come from our own origin. Passwords are scrypt-hashed. Registration, sign-in and uploads are rate limited, with IP addresses stored salted and hashed. Responses carry `nosniff` and `no-referrer`. The operator token is compared in constant time.
- **Model cost and privacy.** The model gets only the customer's words and code-written summaries of earlier turns. Calls have a timeout, an hourly cap and no automatic retries.

## 3. Evidence

- 96 automated tests through the HTTP API: tier boundaries (exactly ¥1,000 is yellow, ¥1,000.01 red), daily totals across requests, the new-payee rule, approval with a changed plan, PIN and SMS failures, passkeys, the safety lock, injection flags, rollback, scheduled re-checks, transfers (route, delay, cancel, returns), the sandbox (unsafe code refused, runaway code stopped), receipts with hidden instructions, human takeover (operators can cancel and unlock but not approve), demo accounts, and the model planner with a fake model.
- Evaluation sets: 224 everyday requests and 69 attacks, each run on a newly opened customer. With the offline planner: 224/224 and 69/69, and no attack ran anything without approval ([report](eval/report-offline.md)). The model planner has not yet been measured against these sets; that needs an AI provider and a deliberate, paid run.

## 4. Known risks

1. **Simulated bank.** No real money moves. A real deployment needs the bank's core systems, real KYC, real SMS and hardware-backed key storage. The transfer route rules, delays and limits follow mainland practice, but their exact values are the demo bank's own.
2. **SMS is a weak second factor.** SMS can be intercepted or SIM-swapped. Passkeys are the stronger option and should be preferred for red-tier actions.
3. **Screening is pattern-based.** New phrasings will get past it: a probe of 30 new phrasings on 14 October found 21 unflagged, all now caught and added to the attack set. That is acceptable because screening only adds friction: the real control is that tiers, approvals and verification are code. It is still a gap for the safety lock, which counts flags.
4. **A coached customer can still approve.** If a scammer convinces the customer to approve with their own PIN and code, the payment can go through. The delay, cancel window, name check, new-payee rules and velocity lock reduce this but cannot eliminate it.
5. **The model planner is not yet measured.** All published numbers come from the offline planner. A real model may misread requests differently; the rules still decide every tier, but wrong plans waste the customer's time and need to be measured before any claim is made.
6. **Model provider and data.** The customer's words go to the configured provider. A deployment in mainland China should use a provider hosted there, with an agreement covering personal information.
7. **Audit log is tamper-evident, not tamper-proof.** Someone with write access to the database could rewrite the whole chain consistently. Mitigation: publish or anchor the chain head externally on a schedule.
8. **Single host.** SQLite on one server: no high availability, and backups are manual.
9. **Operator access.** One shared bearer token plus an operator flag on accounts; no per-operator two-factor authentication or approval workflow yet.
10. **Sandbox isolation.** Resource limits and the AST allow-list run on the same host, without a container or syscall filter. Production should add a container or gVisor-style isolation.
11. **Receipt reading.** A vision model can misread a receipt. Totals are shown on the confirm card for the customer to check, and flagged receipts need strong verification.
12. **Voice input.** It uses the browser's speech recognition, which may send audio to the browser vendor's service and may not be available in every browser in mainland China. Typing always works.
13. **No WAF or bot protection** beyond rate limits.
14. **Demo accounts show their PIN.** The one-click demo account (for judges and visitors) displays its PIN, so whoever holds that browser session can pass the PIN check; the one-time code still comes from the simulated phone in the same session. That is acceptable only because a demo account holds simulated money. A deployment with real customers must set `DEMO_TOOLS_ENABLED=false`, which also turns demo accounts off (tested).

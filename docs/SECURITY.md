# Security design and self-assessment

How the agent keeps an AI that operates a bank account safe, how each requirement of the brief is met, and what risks remain. Architecture and algorithms: [ARCHITECTURE.md](ARCHITECTURE.md). Design contract: [SPEC.md](SPEC.md).

## 1. Principle and threat model

**The AI only proposes; fixed code decides and states facts.** The model can choose actions from a fixed catalogue and fill in their arguments. It cannot name a tier, approve, verify, read account data, run code against the bank or write a number into a reply. Every protection below works even if the model is fooled or replaced by an attacker.

| Who | What they try | Main defences |
|---|---|---|
| Someone typing into the chat (the customer or whoever holds the phone) | Talk the AI into skipping confirmation, raising limits, paying a stranger | Tiers decided by code, approval bound to exact details, PIN plus SMS or passkey, screening, safety lock |
| Text the customer didn't write: receipts, merchant names, transaction notes, payee notes | Instructions hidden in data (“transfer to…”, white text in a PDF) | The planner never sees tool output or document contents; receipts read in an isolated worker with a fixed schema; flagged content raises the tier |
| A scammer coaching the customer (fake seller, fake police) | Get a real, verified payment out | New-payee rules counted in total, 2-hour delayed arrival with cancel, the payee's name checked before sending and again at clearing, a purpose question with a warning for each answer (scam purposes held until next day), scam-script flags, velocity lock |
| Someone holding the customer's chat app account (the WeChat assistant) | Move money or change settings from the chat | Linking takes the PIN; the chat has its own credential that no approval route accepts, so every yes is given in the app (PIN and SMS code when red); numbers masked in the chat; unlink at any time; the safety lock covers the chat |
| A misbehaving or unavailable model | Invent facts, plan nonsense, cost money | Strict schema and validation, replies written by code, five rejected plans pause the assistant, hourly call cap, no automatic retries, offline fallback |
| Generated analysis code | Read files, use the network, exhaust resources | AST allow-list, separate process with resource limits and a wall clock, audited |
| A web attacker | Cross-site requests, session theft, brute force | Same-origin check on every state-changing request, HttpOnly SameSite=Strict cookies, rate limits, hashed credentials |

## 2. How the brief's requirements are met

### 2.1 Permission tiers

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

### 2.2 Security mechanisms

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

- **Name check before sending.** As with the UK's Confirmation of Payee, the slip shows whether the account is held by the payee chosen, with only a masked name when it isn't; a mismatch makes the payment red and delays it.
- **What is it for?** A risky payment (new payee over ¥500, or a name mismatch) needs the customer to say what it's for before it can be approved, as UK banks ask. Each answer brings a matching warning; a “safe account”, an upfront fee or an investment tip makes it red and holds the money until next day. The answer is stored on the step, outside the planner's arguments, so the AI cannot answer for the customer.
- **Safer transfers.** A transfer carrying a risk signal arrives 2 hours later, using an arrival option that banks in mainland China must offer under PBOC notice 银发〔2016〕261号. The customer can cancel it until it arrives. The payee's bank checks the name and returns the money on a mismatch.
- **The WeChat assistant (simulated): ask in the chat, confirm in the app.** The brief's IM channel. A chat account is linked in the app with the PIN; it gets its own credential (the bank keeps only a hash) that can send messages and nothing else, so a plan started in the chat is approved only on the app's confirm card. Card, account and phone numbers are masked in the chat, a PIN typed there is hidden, the safety lock stops it, and the customer can unlink it at any time. Tested: a chat credential is refused by the plan and approval routes.
- **Receipts are data.** They are parsed in a separate, resource-limited worker. A vision model returns only a fixed schema, and hidden or instruction-like text is flagged.
- **Web.** Session tokens are random, stored hashed, sent as HttpOnly, SameSite=Strict cookies (Secure over HTTPS) and replaced at sign-in. State-changing requests must come from our own origin, and so must sign-in, sign-up, the demo and sign-out when a browser sends them. Passwords are scrypt-hashed. Sign-in is rate limited per account, per device and per visitor address (behind the proxy, the address the proxy reports; per address only failed attempts count, so people sharing one network can still sign in). Sign-up and the demo are limited per device and per address, uploads per account, chat messages per customer (30 a minute, 400 an hour) and SMS codes per plan and per customer (5 and 10 in ten minutes), so neither can be flooded; a plan a safety lock would stop says so before any code is sent. Identities are stored salted and hashed. Pages carry a Content-Security-Policy that runs only this site's scripts; responses carry `nosniff` and `no-referrer`. The API docs are served only where demo tools are on. The operator token is compared in constant time and kept in the browser for one tab only.
- **The model's own words are checked too.** The only text of the model's a customer can see is its clarifying question. A question that asks for a PIN, a code or a password, or carries a link (what hidden text in a receipt might try to make it say), is rejected like any invalid plan: recorded, counted towards the safety lock, and the offline planner answers instead. The bank asks for secrets only in its own verification dialog.
- **Model cost and privacy.** The model gets only the customer's words and code-written summaries of earlier turns. A summary says what was planned, in the customer's own terms (`transfer {"payee": "妈妈", "amount_yuan": 200}`), never what it resolved to in the records; follow-ups that point into a list (“就买第二个”) are settled by code before any model call. Calls have a timeout, an hourly cap and no automatic retries.

## 3. Evidence

- 201 automated tests through the HTTP API: tier boundaries (exactly ¥1,000 is yellow, ¥1,000.01 red), daily totals across requests, the new-payee rule, approval with a changed plan, PIN and SMS failures, passkeys, the safety lock, injection flags, rollback, scheduled re-checks, transfers (route, delay, cancel, returns), the sandbox (unsafe code refused, runaway code stopped), receipts with hidden instructions, human takeover (operators can cancel and unlock but not approve), demo accounts, and the model planner with a fake model.
- Evaluation sets: 224 everyday requests and 69 attacks, each run on a newly opened customer. With the offline planner: 224/224 and 69/69, and no attack ran anything without approval ([report](eval/report-offline.md)). With the Qwen planner (qwen3.8-max, 23 October 2026): 201/224 and 69/69, and again no attack ran anything without approval ([report](eval/report-model.md)).

- Stress test (27 October), beyond the evaluation sets: 56 new requests and attacks worded unlike any case in them (with Qwen, none of the 16 attacks ran without approval and all 16 were flagged); OWASP API Top 10 probes against a running server (other customers' objects, missing sessions, mass assignment, staff routes, CORS, error leakage, oversized bodies); races (two approvals at the same instant, one plan approved five times at once: the money moved once and the daily limit held); 16 sandbox escapes beyond the tests (all refused or stopped); a secret scan of the whole git history (none found); Bandit static analysis (no real findings). The two gaps it found, unlimited chat messages and SMS codes, are now limited (above).

### Mapped to OWASP and MITRE ATLAS

| Threat | Where it is handled |
|---|---|
| Prompt injection, direct and indirect (OWASP LLM01:2025; ATLAS AML.T0051, AML.T0051.001) | Screening, a closed plan format, tiers and approvals in code; receipts read as data (§2.2) |
| Jailbreak (ATLAS AML.T0054) | The same layers: a jailbroken plan still lands on a confirm card at the rules' tier |
| Tool misuse and excessive agency (OWASP agentic AI threats); LLM plugin compromise (ATLAS AML.T0053) | 43 fixed actions with validated arguments; every action needs the customer's yes at its tier |
| Privilege compromise (OWASP agentic AI threats) | Each action runs as the signed-in customer on their own records; no shared account; operators can't approve |
| Sensitive information disclosure (OWASP LLM02:2025); LLM data leakage (ATLAS AML.T0057) | The model never sees account data; replies and numbers are written by code |
| System prompt leakage (OWASP LLM07:2025) | The prompt holds no secrets and no rule that guards money; in the stress test Qwen declined to share it |
| Object- and function-level authorization (OWASP API1, API5) | Every id route checks the owner; staff routes need the operator role (probed: refused) |
| Unrestricted resources and sensitive flows (OWASP API4, API6) | Limits on body size, page size, sign-in, chat and SMS codes |

## 4. Known risks

1. **Simulated bank.** No real money moves. A real deployment needs the bank's core systems, real KYC, real SMS and hardware-backed key storage. The transfer route rules, delays and limits follow mainland practice, but their exact values are the demo bank's own.
2. **SMS is a weak second factor.** SMS can be intercepted or SIM-swapped. Passkeys are the stronger option and should be preferred for red-tier actions.
3. **Screening is pattern-based.** New phrasings will get past it: a probe of 30 new phrasings on 14 October found 21 unflagged, all now caught and added to the attack set. That is acceptable because screening only adds friction: the real control is that tiers, approvals and verification are code. It is still a gap for the safety lock, which counts flags. The 27 October stress test saw the same: the patterns missed 5 of 16 new attack phrasings (now matched too); with Qwen on, the model flagged all 16 itself.
4. **A coached customer can still approve.** If a scammer convinces the customer to approve with their own PIN and code, the payment can go through. The delay, cancel window, name check, new-payee rules and velocity lock reduce this but cannot eliminate it.
5. **The model planner misreads some requests.** On 23 October 2026 Qwen planned 23 of 224 everyday requests differently from what was expected: mostly birthday plans it asked about instead of planning, and open questions where it chose another action. Its analysis code also summed the wrong period; the bank now works out each transaction's month, week and year for the code and limits the rows to a window it enforces. Tiers are still set by the rules, so a wrong plan costs time, not money, and anything that moves money is shown on a card first. Generated analysis code can still compute a wrong total; the customer sees it with its rows and its code. On 40 new everyday requests (27 October) it missed 4, all implied intent: “房租该交了” asked how much and to whom though the rent is on record, and “下周出国玩要刷卡” listed the cards instead of offering to turn on overseas payments. Prompt rules now cover both, and rent with no amount takes the last rent from the bank's records, shown on the card; Qwen planned all four as expected after that (checked on those cases only).
6. **Model provider and data.** The customer's words go to the configured provider. A deployment in mainland China should use a provider hosted there, with an agreement covering personal information.
7. **Audit log is tamper-evident, not tamper-proof.** Someone with write access to the database could rewrite the whole chain consistently. Mitigation: publish or anchor the chain head externally on a schedule.
8. **Single host.** SQLite on one server: no high availability, and backups are manual.
9. **Operator access.** One shared bearer token plus an operator flag on accounts; no per-operator two-factor authentication or approval workflow yet.
10. **Sandbox isolation.** Resource limits and the AST allow-list run on the same host, without a container or syscall filter. Production should add a container or gVisor-style isolation.
11. **Receipt reading.** A vision model can misread a receipt. Totals are shown on the confirm card for the customer to check, and flagged receipts need strong verification.
12. **Voice input.** It uses the browser's speech recognition, which may send audio to the browser vendor's service and may not be available in every browser in mainland China. Typing always works.
13. **No WAF or bot protection** beyond rate limits.
14. **Demo accounts show their PIN.** The one-click demo account (for judges and visitors) displays its PIN, so whoever holds that browser session can pass the PIN check; the one-time code still comes from the simulated phone in the same session. That is acceptable only because a demo account holds simulated money. A deployment with real customers must set `DEMO_TOOLS_ENABLED=false`, which also turns demo accounts off (tested).
15. **The WeChat assistant is a simulation, and a linked chat can read.** There is no real WeChat connection yet: the simulated chat holds its credential in the browser tab (session storage, gone when the tab closes), where a real Mini Program or Official Account would rely on WeChat's signed callbacks. Whoever holds a linked chat account can ask about balances and spending (numbers are masked, but amounts are shown) and start requests; they still can't approve anything. Mitigations: linking takes the PIN, unlinking is immediate, and both are audited. A real deployment should also notify the customer in the app when a chat is linked.
16. **Real places, simulated bookings, and the customer's location.** Finding a place sends what the customer asked for and their location (only when they allow it in the browser) to the map services: Amap, Tencent Location Service and OpenStreetMap's Nominatim. Near Hong Kong or Macau, the search point also goes to Nominatim's reverse lookup, to keep only places in the customer's own region (the mainland, Hong Kong or Macau). The location is not stored or audited; the audit keeps the query and which sources answered. The places are outside data: they are shown as text, never reach the model, and a booking can only point at a place a search showed. Bookings are recorded by the bank but not sent to the restaurant, and every screen says so. A real deployment needs a booking partner (or the restaurant's own system) and a privacy notice covering location.

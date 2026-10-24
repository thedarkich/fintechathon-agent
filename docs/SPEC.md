# Banking AI Agent: specification

Entry for the 2026 Shenzhen International FinTech Competition (FinTechathon), Domestic AI Track, "Banking AI Agent" (银行 AI 智能体). Submission deadline 2 November 2026.

**One rule shapes everything: the AI only proposes. Fixed code decides what is allowed, and code (not the AI) states every fact.**

## 1. Request flow

```
message (text / photo / voice)
  → screening      instruction-like or bypass attempts are flagged (never blocks a normal request on its own)
  → planner        AI (or the offline planner) returns a plan: steps from the action catalogue, as a DAG
  → validation     unknown actions, extra fields, bad arguments, cycles, more than 8 steps → rejected
  → resolution     names / phones / notes / card numbers / merchants matched against the customer's own data;
                   ambiguity → a clarification question with choices built by code
  → policy         each step gets green / yellow / red from §3; risk signals can only raise a tier
  → approval       green runs; yellow needs a confirmation of the exact details; red also needs PIN + SMS code or passkey
  → execution      steps run in dependency order; scheduled steps wait for their time and are re-checked then
  → reply          built by code from the results (both languages); the AI never writes amounts, balances or outcomes
  → audit          every stage above appends to the customer's hash-chained audit log
```

Tool results never go back into the model. The planner sees only the customer's own words, short code-written summaries of earlier turns (what was planned, in the customer's terms, never what it resolved to), today's date and the action catalogue. Follow-ups that lean on the turn before (“再转100”, “餐饮呢”, “就买第二个”) are completed by code first; the model is asked only when that doesn't apply. Merchant names, transaction notes and other outside text never reach it, so they cannot inject instructions.

## 2. Money and time

- Amounts are integer fen (分). The API also returns a formatted string.
- Time zone: China Standard Time (UTC+8, no daylight saving). "Today" is the calendar day in UTC+8.
- Each customer has a **demo clock** (an offset from real time) so scheduled steps, reminders and birthdays can be shown without waiting. Only the demo panel and tests move it.

## 3. Permission tiers

The thresholds match the brief exactly. **Today's agent payments** = transfers + merchant orders + scheduled transfers executed today (UTC+8), plus the step being decided and earlier steps of the same plan that run today. Internal moves (reserve funds, wealth redemption into the customer's own account) do not count.

| Action | Tier | Rule ID |
|---|---|---|
| `balance`, `transactions`, `spending`, `report`, `anomalies`, `analyze` | green | `G_QUERY` |
| `payees`, `cards`, `scheduled`, `collections`, `reserves`, `notifications` | green | `G_QUERY` |
| `wealth_holdings`, `wealth_products`, `wealth_compare`, `wealth_recommend` | green | `G_QUERY` |
| `contact_lookup`, `read_receipt` | green | `G_QUERY` |
| `subscriptions` (query) | yellow | `Y_SUBSCRIPTION` (the brief lists subscription queries as yellow) |
| `subscription_cancel`, `subscription_remind` | yellow | `Y_SUBSCRIPTION` |
| `transfer`, `schedule_transfer`, `merchant_order` with today's agent payments ≤ ¥1,000 | yellow | `Y_SMALL_PAYMENT` |
| same with today's agent payments > ¥1,000 | red | `R_LARGE_PAYMENT` |
| `collect` (split bill / AA collection request) | yellow | `Y_COLLECTION` |
| `card_apply` (virtual or physical) | yellow | `Y_CARD_APPLY` |
| `card_freeze`, `card_restrict` turning something **off**, `card_limit` **lower** | yellow | `Y_RISK_REDUCING` |
| `card_unfreeze`, `card_restrict` turning something **on**, `card_limit` **higher** | red | `R_RISK_INCREASING` |
| `card_report_lost` | red | `R_CARD_LOSS` |
| `reserve_create`, `reserve_release` | yellow | `Y_INTERNAL_MOVE` |
| `wealth_redeem` | yellow | `Y_WEALTH_REDEEM` |
| `risk_assessment` | yellow | `Y_PROFILE_CHANGE` |
| `payee_add` | yellow | `Y_PAYEE_ADD` |
| `transfer_cancel` (a delayed transfer before it arrives) | yellow | `Y_TRANSFER_CANCEL` |
| `scheduled_cancel` (a scheduled or monthly transfer) | yellow | `Y_SCHEDULE_CANCEL` |
| `plan_cancel` (a plan with steps still waiting; `undo` also reverses finished steps) | yellow | `Y_STOP_PLAN` |
| `wealth_subscribe` | red | `R_INVESTMENT` |
| `password_change`, `pin_change` | red | `R_CREDENTIAL` |

Risk signals that raise a tier (never lower one):
- `S_NEW_PAYEE_LARGE`: payments over ¥500 in total (including earlier and scheduled ones) to a payee added in the last 24 hours → red.
- `S_FLAGGED_REQUEST`: the request was flagged by screening → yellow becomes red.
- `S_NAME_MISMATCH`: before anything is sent, the payee's bank says the account is held by someone other than the payee chosen → red (the slip shows the holder's masked name, like the UK's Confirmation of Payee).
- `S_SCAM_PURPOSE`: the customer says the payment is for an investment someone recommended, a “safe account”, or a fee to get a loan, refund or prize → red, and the money arrives next day.

**Payment purpose.** A transfer carrying `S_NEW_PAYEE_LARGE` or `S_NAME_MISMATCH` cannot be approved until the customer says what it is for, on the slip (`POST /api/plans/{id}/purpose`): family or friends, buying something, an investment someone recommended, a “safe account”, a fee, or something else. Each answer brings its own warning. The purpose is stored on the step, not in the planner's arguments, so the AI can never answer it; answering changes the approval hash.
- `S_LOCK`: an active safety lock blocks the step outright (§7).

A step approved at one tier is checked again when it actually runs. If the tier is now higher, the step waits for the higher approval.

## 4. Approval

- **Yellow**: the client shows the confirmation card (every step, every resolved detail, every tier) and sends back the plan's `approval_hash`. A changed plan has a different hash, so an old confirmation cannot approve it.
- **Red**: confirmation plus the 6-digit transaction PIN plus a second factor: an SMS code (simulated; delivered to the in-app phone panel with the operation details in the text) or a passkey (WebAuthn: device face/fingerprint unlock or a security key). Codes and PINs go to a separate endpoint and are never shown to the AI or written to the audit log.
- Codes expire after 5 minutes and allow 3 attempts.

## 5. Plan format (planner output)

```json
{
  "steps": [
    {"id": "s1", "action": "contact_lookup", "args": {"who": "wife"}},
    {"id": "s2", "action": "reserve_create", "args": {"amount_yuan": 1000, "name": "Birthday", "month_of": "$s1.birthday"}, "after": ["s1"]},
    {"id": "s3", "action": "merchant_order", "args": {"merchant": "florist", "item": "bouquet", "deliver_on": "$s1.birthday", "pay_from": "$s2.reserve_id"}, "after": ["s2"], "run_at": {"ref": "s1.birthday", "offset_days": -2}},
    {"id": "s4", "action": "merchant_order", "args": {"merchant": "bakery", "item": "cake", "deliver_on": "$s1.birthday", "pay_from": "$s2.reserve_id"}, "after": ["s2"], "run_at": {"ref": "s1.birthday", "offset_days": -2}}
  ],
  "ask": null,
  "suspicious": false
}
```

- `after` lists dependencies; the graph must be acyclic. `$<step>.<field>` refers to a field of an earlier step's result.
- `ask` is a clarification question (`{"en": ..., "zh": ...}`) when the request cannot be planned. It may not contain digits that are not in the customer's own messages.
- `suspicious` is the planner's own judgement that the message tries to bypass rules. It feeds screening and the safety lock.

## 6. Execution, interruption, rollback, takeover

- Plan states: `clarifying`, `awaiting_approval`, `running`, `scheduled`, `done`, `failed`, `cancelled`, `rolled_back`, `escalated`.
- Step states: `pending`, `waiting` (for time or approval), `running`, `done`, `failed`, `skipped`, `cancelled`, `compensated`.
- **Stop**: a plan can be cancelled at any time before its last step; pending and scheduled steps are cancelled. The customer can do this from the plan's card or by saying so (`plan_cancel`: "停止生日计划"), and can stop a scheduled or monthly transfer the same way (`scheduled_cancel`).
- **Rollback**: each action declares a compensation. On failure or on request, finished steps are compensated in reverse order. A compensation never moves the account into a less safe state (a freeze is not undone automatically; a transfer that has arrived cannot be undone and the reply says so, while a delayed one can be cancelled until it arrives, §6a). Money for multi-step plans is set aside first (reserve) and spent last.
- **Edit**: changing a pending step re-runs validation, resolution and policy and needs a new approval.
- **Human takeover**: the customer can ask for a person at any time; after two unclear messages in a row the assistant offers one, and a customer under a safety lock appears in the operator queue. While a person has the conversation, the assistant plans nothing. An operator sees the conversation, the plans and the audit trail, and can reply, cancel a plan, lift a lock and hand the conversation back. An operator can never approve a step on the customer's behalf.

## 6a. How the bank processes a transfer (simulated)

After approval a transfer belongs to the bank, not the agent (`bank/transfers.py`), and moves through `accepted → clearing → arrived`, or ends `returned` (the payee's bank refuses it) or `cancelled` (the customer stops a delayed transfer). Money leaves when it is accepted and comes back on a return or cancel. Every stage is a timestamped event, written to the audit log and shown on the Transfers page.

- **Route**: a payee at our own bank (中联银行, Central Union Bank) is a same-bank transfer and arrives at once. Any other bank goes through a simulated 超级网银 (the central bank's online interbank system: real time, around the clock). The ¥50,000 single-transfer cap keeps every transfer within it.
- **Arrival**: instant, standard (2 hours later) or next day (early morning), the choices banks in mainland China must offer under the PBOC's 2016 anti-telecom-fraud notice (银发〔2016〕261号); the customer picks one on the Transfers screen. Exact timings vary by bank; these are the demo bank's own.
- **Risky transfers wait** (`policy.safer_arrival`, fixed code): a transfer carrying `S_NEW_PAYEE_LARGE`, `S_NAME_MISMATCH`, `S_FLAGGED_REQUEST` or `S_FLAGGED_CONTENT` arrives in 2 hours instead of now, and one carrying `S_SCAM_PURPOSE` arrives next day; the rules never make a transfer faster than the customer chose. The slip says so and the approval hash covers it; the model can neither request nor skip it.
- **Cancel**: `transfer_cancel` (yellow) stops a delayed transfer until its arrival time; afterwards the bank refuses.
- **Name check**: before sending, the slip shows whether the account holder matches the payee (`S_NAME_MISMATCH` when not); at clearing the payee's bank checks again and returns the money if they differ (`REGISTERED_HOLDERS`; the seeded seller added today gave an account in someone else's name).
- **Phones**: the customer's simulated phone gets return and cancel texts; the payee's phone gets the arrival text their own bank would send (`PayeeMessage`), for the two-phone demo.
- **Demo control**: `POST /api/demo/transfers/{id}` clears a waiting transfer now or makes the payee's bank return it (name mismatch, frozen account, refused); delayed transfers also clear on their own as bank time passes.

## 7. Safety lock (circuit breaker)

| Trigger | Lock | Cleared by |
|---|---|---|
| 3 failed PIN / code / passkey checks in 15 min | `red` (no red steps) for 30 min | time, or an operator |
| 3 flagged requests in 10 min | `agent` (the assistant stops planning) | the customer passing red verification, or an operator |
| 5 rejected plans in 10 min (the model misbehaving) | `agent` | as above |
| 3 payments to payees added in the last 24 h within 1 h | `payments` (no transfers or orders) | the customer passing red verification, or an operator |

Every lock and unlock is audited and shown to the customer.

## 8. Audit log

Append-only rows per customer: `seq`, `kind`, `plan_id`, `data`, `at`, `prev_hash`, `hash` where `hash = sha256(prev_hash + canonical_json(seq, kind, plan_id, data, at))`. `GET /api/audit/verify` recomputes the chain. Kinds: `request`, `screening`, `plan_proposed`, `plan_rejected`, `resolution`, `clarification`, `policy`, `approval_requested`, `approved`, `verification_failed`, `verified`, `step_started`, `step_done`, `step_failed`, `compensated`, `cancelled`, `transfer` (each stage of a transfer in the bank), `lock`, `unlock`, `operator`, `notification`. Secrets (PINs, codes, passwords) are never logged.

## 9. Sandbox (open-ended analysis)

For questions the fixed analyses cannot answer ("how much on coffee on weekends after 8 pm?") the AI writes a short Python function. It runs in a separate process with no network, no file access beyond a read-only copy of that customer's transactions, CPU/memory/time limits and an import allow-list. The result is a table that code renders. Every run (code, limits, outcome) is audited.

## 10. Data model (simulated bank)

`Customer` (the account), `BankAccount` (checking, savings, reserve), `Txn`, `Payee` (name, aliases, phone, bank, masked account, relationship, birthday, note), `Card` (physical/virtual, status, limits, restriction switches), `Subscription`, `ScheduledTransfer`, `Transfer` (route, arrival, stage events, §6a), `PayeeMessage` (the payee's phone), `Collection` (split-bill requests), `WealthProduct`, `Holding`, `RiskProfile`, `Merchant` + `Order` (partner services for the birthday plan: florist, bakery, gift shop, restaurant booking), `Plan`, `Conversation` + `Message`, `Challenge` (SMS / passkey), `Passkey`, `SmsMessage` (simulated phone), `Notification`, `SafetyLock`, `AuditEntry`, `DemoClock`.

Every customer gets their own seeded bank on sign-up: about 22 months of realistic transactions (so a full-year report works), family and friend payees (including two people with the same pinyin name, to show clarification), subscriptions (including a duplicate music service and a forgotten trial), seeded anomalies (duplicate charge, late-night large purchase at a new merchant, overseas online charge), two cards, wealth holdings and a risk profile. `POST /api/demo/reset` restores it.

## 10a. Channels: the WeChat assistant (simulated)

The brief's IM channel, simulated until the WeChat Mini Program exists. Ask in the chat, confirm in the app.

- A chat account is linked in the app with the transaction PIN (`POST /api/wechat/link`; a wrong PIN counts towards the safety lock; nothing is linked while a `red` or `agent` lock is on). Linking issues the channel's own credential, shown once; only its sha256 is stored (`ChannelLink`). Linking again replaces it; `POST /api/wechat/unlink` ends it. Both are audited (`channel_linked`, `channel_unlinked`).
- The chat side calls `POST /api/channels/wechat/message` with that credential as a bearer token, never with the app's session. The message goes through `service.handle` like any chat message (conversation kind `wechat`, request audited with `channel: wechat`); rate limit 20 a minute per link.
- No other route accepts the credential. A plan waiting for approval is returned as a `confirm` reply with a link to `/#/confirm/{plan_id}`, the app's own confirm card, with the same approval hash, PIN and code.
- Replies are written by code as in the app, then turned into chat messages: phone numbers and account numbers masked, at most 12 lines with a link to the app for the rest, choices numbered.

## 11. Evaluation support

- `POST /api/chat` returns structured results: the plan, each step's tier and rule, status and the reply, so a script can check them.
- `LLM_ENABLED=false` uses the offline planner: deterministic, no API key, used by the test suite.
- The AI provider is any OpenAI-compatible endpoint (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`), so evaluators can plug in their own.

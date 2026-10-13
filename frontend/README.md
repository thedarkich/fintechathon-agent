# Frontend

A bilingual (中文 / English) React app with light and dark themes. Every plan is drawn as a 审批栏 (sign-off row): one box per step, stamped by whoever decided it, with a round seal for the outcome.

| Page | What it shows |
|---|---|
| Landing | The hero terminal shows a request, the rule checks and the receipt |
| Sign in / Create account | Email sign-in, plus the 6-digit transaction PIN |
| Assistant | Conversation → the AI's plan → the bank's rules → your approval, with the step row and "who decided what" |
| Accounts | Accounts, payees, scheduled transfers, split bills, payments |
| Transfers | Each transfer in the bank (accepted → clearing → arrived, returned or cancelled), cancel before arrival, demo stage controls, and the customer's and payee's phones side by side |
| Bills | Spending by period, category and merchant; transactions worth a second look; 90-day search |
| Wealth | Holdings and products, with risk levels R1–R5 |
| Cards & controls | Cards, subscriptions, safety lock, passkeys, simulated phone, demo clock |
| Ledger | The hash-chained audit log |
| Operator | The human-takeover console, opened with an operator token |

## Run

```bash
npm ci
npm run dev        # http://localhost:5173, proxies /api to the backend on :8000
npm run build      # dist/ is served by the backend
```

## Rules

- `src/api/types.ts` matches the backend's responses; change both together.
- Every user-facing string has Chinese and English, inline with `tr(en, zh)` or in `src/i18n/strings.ts`.
- Colours come from the CSS variables in `src/index.css` (`bg-field`, `text-ink2`, `border-rule`, `text-cinnabar`, `text-jade`), so light and dark both work.
- No CDNs or external fonts: phones in mainland China must load everything from our own server.
- Hash routes (`/#/assistant`) are kept for WeChat's in-app browser.

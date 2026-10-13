# Frontend

A bilingual (中文 / English) React app with light and dark themes that works at phone width. The customer talks to the assistant; every request that needs a yes becomes one confirm card: what will happen in label–value rows, the reason in one line, and the buttons. How the request was checked (the AI, the bank's rules, you) is one tap away on the card, and in full on the How it stays safe page.

| Page | Route | What it shows |
|---|---|---|
| Landing | `/` | The promise, a phone playing a transfer from request to Mum's text message, example requests, six features, safety. “Try it now” opens a demo account in one click |
| How it stays safe | `/how` | The AI proposes, the rules decide, you approve: the three levels, an example request with the rule checks, the protections, the numbers |
| Sign in / Create account | `/login`, `/signup` | Email sign-in, the 6-digit transaction PIN, or a demo account |
| Assistant | `/assistant` | Chat first: suggestions, the conversation, a confirm card per request, voice and receipt upload. `?ask=` sends a request on arrival |
| Accounts & transfers | `/accounts` | Balances, accounts, where each transfer is (accepted → clearing → arrived, returned or cancelled) with your phone and the payee's phone, payees, scheduled transfers (with Stop), split bills |
| Spending | `/bills` | Spending by period, category and merchant; transactions worth a second look; search |
| Invest | `/wealth` | Holdings, risk level, products with R1–R5 |
| Cards & security | `/controls` | Cards and their switches, subscriptions, safety lock, passkeys, simulated phone, demo clock, reset |
| History | `/ledger` | What you asked for (open one to see its card and trail), then the hash-chained audit log |
| Operator | `/operator` | The human-takeover console, for operator accounts or the admin token |

`/transfers` redirects to the transfers section of Accounts.

## Run

```bash
npm ci
npm run dev        # http://localhost:5173, proxies /api to the backend on :8000
npm run build      # dist/ is served by the backend
```

## Rules

- `src/api/types.ts` matches the backend's responses; change both together.
- Every user-facing string has Chinese and English, inline with `tr(en, zh)` or in `src/i18n/strings.ts`.
- Customer screens use plain words: 直接办 / 需确认 / 需验证 (done right away / needs your OK / needs PIN + code), never rule codes.
- Colours come from the CSS variables in `src/index.css` (`bg-field`, `text-ink2`, `border-rule`, `text-cinnabar`, `text-jade`), so light and dark both work.
- No CDNs or external fonts: phones in mainland China must load everything from our own server.
- Hash routes (`/#/assistant`) are kept for WeChat's in-app browser.

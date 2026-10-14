# Frontend

A bilingual (中文 / English) React app with light and dark themes that works at phone width. The customer talks to the assistant; every request that needs a yes becomes one confirm card: what will happen in label–value rows, the reason in one line, and the buttons. How the request was checked (the AI, the bank's rules, you) is one tap away on the card, and in full on the How it stays safe page.

| Page | Route | What it shows |
|---|---|---|
| Landing | `/` | The promise, a phone playing a transfer from request to Mum's text message, example requests, six features, safety. “Try it now” opens a demo account in one click |
| How it stays safe | `/how` | The AI proposes, the rules decide, you approve: the three levels, an example request with the rule checks, the protections, the numbers |
| Sign in / Create account | `/login`, `/signup` | Email sign-in, the 6-digit transaction PIN, or a demo account; signing in opens Home |
| Home | `/home` | The first screen after signing in: current account (amounts can be hidden), a grid of services, a box to ask the assistant, bills to pay, recent transactions |
| Transfers | `/send` | Type a phone number and see who it is (a saved payee, or a masked name such as “*小明” and their bank); recent people one tap away; the transfers with that person beside it |
| Payments | `/payments` | Mobile top-up, electricity, water, gas, internet & TV, property fees, traffic fines: check the bill, pay it, save it, or let it pay itself up to a monthly limit |
| QR pay | `/qr` | Scan a shop's code (the camera where the browser can read codes, or tap a demo code), check the shop and amount, pay; a demo till makes a code for one sale. Other codes are reported, never opened |
| Assistant | `/assistant` | Chat first: suggestions, the conversation, a confirm card per request, voice and receipt upload. Past chats in a side list that opens and closes (a drawer on phones); removing one only hides it, History keeps the record. `?ask=` sends a request on arrival |
| Accounts & transfers | `/accounts` | Total and accounts; each transfer on one line with its stages folded underneath, beside one SMS panel (your phone, the payee's phone); payees, scheduled transfers (with Stop), split bills |
| Spending | `/bills` | Spending by period, category and merchant; transactions worth a second look; search |
| Invest | `/wealth` | Holdings, risk level, products with R1–R5 |
| Cards & security | `/controls` | One tile per card (switches, freeze, limit, report lost), subscriptions, safety lock, passkeys, demo clock and reset |
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
- No intro paragraphs: a page is a title, then sections (`PageHead`, `Section` in `components/bits.tsx`). Actions that need details open the assistant with an example (`AskButton`, `/assistant?hint=…`).
- A payment from a screen goes to `POST /api/screens/plan` and waits on the same confirm card as the chat (`components/ScreenPlan.tsx`), so it gets the same tiers, PIN and code, and audit.
- The assistant's replies are plain text from the backend. `components/ReplyText.tsx` lays them out: `· ` lines become a list (an amount at the end goes to the right), `提示：` / `Tip:` lines a tip, a line in brackets a small note. Keep that shape when writing replies.
- Customer screens use plain words: 直接办 / 需确认 / 需验证 (done right away / needs your OK / needs PIN + code), never rule codes.
- Colours come from the CSS variables in `src/index.css` (`bg-field`, `text-ink2`, `border-rule`, `text-cinnabar`, `text-jade`), so light and dark both work.
- No CDNs or external fonts: phones in mainland China must load everything from our own server.
- Hash routes (`/#/assistant`) are kept for WeChat's in-app browser.

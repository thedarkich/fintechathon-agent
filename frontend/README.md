# Frontend

A bilingual (中文 / English) React app with light and dark themes that works at phone width. The menu follows the brief's six scenarios: Transfers, Spending, Invest, Cards, Subscriptions, and many things in one sentence (the assistant). The look: white cards with a soft shadow, pastel icon circles, big bold figures, thick bars and rating pills, and coloured notices (pale red alert, cream highlight). The customer talks to the assistant; every request that needs a yes becomes one confirm card: what will happen in label–value rows, the reason in one line, and the buttons. How the request was checked (the AI, the bank's rules, you) is one tap away on the card, and in full on the How it stays safe page.

| Page | Route | What it shows |
|---|---|---|
| Landing | `/` | A hero with a phone playing a transfer, the six scenarios as cards (each with a sentence to try), safety in three steps (the AI proposes, the rules decide, you say yes), and a box to just say what you need. “Try it now” opens a demo account in one click |
| How it stays safe | `/how` | The AI proposes, the rules decide, you approve: the three levels, an example request with the rule checks, the protections, the numbers |
| Sign in / Create account | `/login`, `/signup` | Email sign-in, the 6-digit transaction PIN, or a demo account; signing in opens Home |
| Home | `/home` | The first screen after signing in: a box to ask the assistant, current account (amounts can be hidden), one tile per scenario (the sixth starts a birthday plan in the assistant), and what's coming up: reminders, a payment worth a look, the next subscription charge |
| Transfers | `/send` | Tabs: Send (type a phone number and see who it is, a saved payee or a masked name such as “*小明” and their bank; recent people one tap away; arrival now, in 2 hours or tomorrow), Where my money is (each transfer with its stages, beside one SMS panel for your phone and the payee's), Payees, Scheduled & split |
| Assistant | `/assistant` | Chat first: suggestions, the conversation, a confirm card per request, voice and receipt upload. Past chats in a side list that opens and closes (a drawer on phones); removing one only hides it, History keeps the record. `?ask=` sends a request on arrival |
| Spending | `/bills` | Spent, income, left over and the change on last period; by category and merchant; recent transactions; transactions worth a second look; search |
| Invest | `/wealth` | Holdings, risk level, products with R1–R5 |
| Cards | `/controls` | Tabs: Cards (one tile per card: switches, freeze, limit, report lost) and Security (safety lock, passkeys) |
| Subscriptions | `/subscriptions` | What renews automatically and what it costs a month, the next charge, services paid for twice; remind or cancel each |
| History | `/ledger` | What you asked for (open one to see its card and trail), then the hash-chained audit log |
| Operator | `/operator` | The human-takeover console, for operator accounts or the admin token |

Older links still work: `/accounts` and `/transfers` open the matching tab of Transfers, `/controls?tab=subscriptions` opens Subscriptions. The demo clock and reset are under Demo tools in the header.

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
- The look: a white page with grey rounded surfaces (`.ruled`, `bg-[var(--field)]`) and no borders; one green (`--action`) for actions and the active tab; the bright `--cta` only for the main action on a green surface; pill tabs with `Segmented` (`components/bits.tsx`). Text on green is solid white so it stays readable.
- The header is pinned (`--header-h`); on phones the app's menu is a bottom tab bar (`components/TabBar.tsx`, `--tabbar-h`). Anything sticky uses those two variables.
- The logo is `BrandMark` (`components/Seal.tsx`); `public/logo.svg` is the same drawing, used for the favicon. The PNG icons in `public/` are rendered from it.
- No CDNs or external fonts: phones in mainland China must load everything from our own server.
- The font is MiSans by Xiaomi, bundled from the npm package `misans` (the package itself is Apache-2.0). Xiaomi publishes MiSans for free commercial use under its own MiSans licence; read that licence before shipping this to real customers.
- Hash routes (`/#/assistant`) are kept for WeChat's in-app browser.

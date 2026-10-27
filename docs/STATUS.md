# Project status (24 October 2026)

For whoever continues the work, a person or a Claude Code session. Keep this file current: when something here changes,
change it here too.

## The competition

- 2026 Shenzhen International FinTech Competition (FinTechathon), **Domestic AI Track: Banking AI Agent**. The bank in
  the entry is 中联银行 / Central Union Bank.
- **Submission deadline: 2 November 2026.** Until then the entry can be improved and resubmitted; the last valid
  submission counts.
- **Online review: 3–8 November 2026** (automated evaluation and expert blind review, per Xinhua's launch article); the top ten are announced on
  10 November and go on to the on-site AI hackathon on **28–29 November** in Shenzhen; the finale and awards are on
  30 November (the official site's schedule as of 27 October; it was moved from 21–23 November).
- The team, **Callisto**, has four members; the pitch is in Chinese. 韩晨 (武汉大学), team leader; 熊金生 (武汉大学), frontend;
  霍以恒 (武汉理工大学), the Chinese presentation; 余梁毅 (浙大宁波理工学院 / NingboTech University), testing.

## The required materials: read this before changing anything

The organisers list five items. Four are required (必交), one is optional (可选):

| Item | Required | Status | Where |
|---|---|---|---|
| **技术文档**: architecture diagram, algorithm description, security design | 必交 | Done | [ARCHITECTURE.zh.md](ARCHITECTURE.zh.md) ([English](ARCHITECTURE.md)): §一 architecture with [img/architecture.svg](img/architecture.svg), §二 a request end to end, §三 eleven core algorithms; [SECURITY.zh.md](SECURITY.zh.md) for the security design |
| **答辩 PPT**: the talk is **at most 10 minutes** | 必交 | Done except the team details | [../submission/slides](../submission/slides) (three decks of 17 slides; speaker notes total **9:40**) and the same decks on claude.ai |
| **源代码**: README, repository, deployment guide and test cases | 必交 | Done | public repo https://github.com/thedarkich/fintechathon-agent; [../README.zh.md](../README.zh.md) / [../README.md](../README.md) (with 部署 / Deploy); [../deploy](../deploy); [../backend/tests](../backend/tests); [../evals](../evals) |
| **安全自评**: permission tiers and the list of known risks | 必交 | Done | [SECURITY.zh.md](SECURITY.zh.md) §2.1 (the three tiers) and §四 (15 known risks) |
| **演示视频**: **at most 5 minutes** | 可选 | Not recorded | script: [DEMO.md](DEMO.md) |

Hard limits that come from these criteria:

- The talk must fit in **10 minutes**. The speaker notes add up to 9:40 (each `<aside>` starts with its time; the live demo counts 3:00). Don't
  add slides or notes that push it past 10.
- The video, if there is one, is **5 minutes at most**.
- Everything is in by **2 November**.
- The documents must match the code: every number they quote is measured (next section).

## Measured numbers (quote these and nothing else)

- **187 automated tests** (`bash scripts/check.sh` runs them).
- **Offline planner** (18 October 2026): 224/224 everyday requests, 69/69 attacks ([eval/report-offline.md](eval/report-offline.md)).
- **Qwen planner** (`qwen/qwen3.8-max` through TokenRouter, thinking off), full run on 23 October 2026, before that day's
  prompt fixes: 201/224 requests, 69/69 attacks, no attack ran anything without approval, a median of 3.7 s per plan
  ([eval/report-model.md](eval/report-model.md)). The later fixes were checked on the cases they target and in the
  browser, not with a second full run.

These appear in: `README.md`, `README.zh.md`, `docs/ARCHITECTURE*.md`, `docs/SECURITY*.md`, `docs/PITCH.md`,
`docs/DEMO.md`, `frontend/src/pages/How.tsx`, each deck's `slides/evidence.html` (and the decks on claude.ai). When one
changes, `git grep` the old value and update every place.

## Done (22–24 October 2026)

- **Qwen in the app.** The model plans; fixed code checks, sets tiers, asks for approval and writes every fact. Its
  thinking step is off (`LLM_THINKING=false`: about 4 s per plan instead of 7–60). Each plan says who planned it.
  Fixes from the evaluation: analysis code gets each transaction's month, week and year offsets and a row window the
  bank enforces (the model had summed wrong periods); prompt rules for the birthday plan, lost or stolen cards and
  spending analysis (one report, the year for "history"); `datetime.strptime` works in the sandbox.
- **Complete answers.** The transactions card pages through every match, ten a page (`GET /api/bank/transactions/search`);
  analysis rows page; spending and report cards list every category; the Spending page lists all 90 days in pages.
- **Spending calendar** on the Spending page: each day's spending, darker for more; tap a day for its payments.
- **Motion** throughout (pages, messages, typing indicator, dialogs, plan steps, bars, theme), none under reduced motion.
- **Large-text mode removed** from the app, the docs and the slides.
- **Docs:** a Chinese README; the Qwen results in the README, the security self-assessment (evidence and risk 5) and
  the architecture docs; the pitch outline for the talk; the demo script records with Qwen on.
- **Slides:** three decks (Chinese for reading, Chinese for presenting, English), 17 slides, 9:40 of notes, AI-forward
  story ("AI 理解和规划，规则守住钱"), the Qwen results and the GitHub link. Sources in `submission/slides`, builders in
  `submission/`.
- **Repository** public on GitHub; ready for Claude Code cloud sessions (`CLAUDE.md`, `.claude/settings.json`,
  `scripts/cloud_setup.sh`, `scripts/check.sh`, `scripts/qwen_check.py`, `scripts/eval_model.py`).
- **Fixes from probing new everyday wordings (24 October),** judged against the track's criteria (task completion 40%,
  security 30%, innovation and interaction 30%: clarification, error recovery, colloquial input):
  - a clarifying choice can be answered in words ("第一个", "第二位", "the first one"), not only by tapping;
  - the offline planner: two or three requests in one message ("查余额，再看看有没有异常交易") become one plan; weeks and
    recent months ("上周", "这周", "最近三个月", "今年收入") are the periods asked for; 月报, 每个月被扣了哪些钱, 消费习惯,
    交下个月的房租, "weird charges", "Cancel Netflix" and "我女朋友" are understood; a greeting is answered;
  - a model plan that fails validation is still refused, audited and counted towards the lock, and the offline planner
    then answers (before, the customer only got "please try again");
  - a birthday plan for a date the customer gives says it uses that date (it seemed to contradict them);
  - a month or year still running is compared with the same days of the period before (it was compared with all of it);
  - the Qwen prompt covers the remaining failures of the 23 October run (money to or from a person, salary, periods,
    several requests, undoing a transfer, a forgotten PIN, buying without naming a product); not yet measured with Qwen;
  - `scripts/qwen_check.py` and `scripts/eval_model.py` find the backend when run as documented (they couldn't before).
- **The six categories, item by item (24 October):** every sub-item of the brief's six scenarios tried in chat with
  new wordings, replies read in full, and each category's page checked. Fixed: a card limit called 额度 only listed the
  cards; the birthday plan had no "other services" (now a gift shop and a restaurant booking next to the florist and
  bakery; a booking reads 用餐, not 送达); the Invest page had no way to compare products (tick two or more), and a
  comparison in chat now shows a side-by-side table with the bank's conclusion; two halves of one request about the
  same thing ("我想理财，有什么推荐") are no longer split. One evaluation expectation changed with the gift shop:
  `bday-06` ("帮我预留500买礼物") now expects one gift order instead of a florist and a bakery order.
- **WeChat assistant (simulated), 24 October:** the brief's IM channel ("apps and IM"), as the coming WeChat Mini
  Program will work: ask in WeChat, confirm in the app ("IM 里说，App 里确认"). A new page 微信助手（模拟） with a
  phone-shaped chat and the bank app's side. Linking takes the PIN and issues the channel's own credential (stored only
  as a hash); the chat calls `POST /api/channels/wechat/message` with it and never with the app's session, so it can ask
  and plan but approve nothing: a payment comes back as a link to the app's confirm card. Numbers masked in the chat,
  the safety lock covers it, unlink at any time, every request audited with its channel. Docs: ARCHITECTURE §3.12,
  SECURITY (threat table, "beyond the brief", known risk 15), SPEC §10a, READMEs, DEMO (optional 20-second swap),
  PITCH and one line on the “Built for banks in China” slide of each deck. The team decided the real Mini Program comes later
  (for the final, if the entry gets there).
- **Full click-through with Qwen on (24 October, evening):** every page clicked (an automated pass over 16 pages, 0
  errors) and each flow done by hand: WeChat request → confirm in the app; transfers by payee and by phone number with
  PIN and SMS code; card switches, freeze, unfreeze, limit; risk questionnaire, buy, redeem; cancel a subscription;
  History details and the audit chain; three bypass attempts → lock → unlock; the birthday plan run with the demo clock;
  sign-in and sign-up checks. Fixed:
  - a wrong PIN, SMS code or passkey said "Your session ended. Sign in again." (any 401 was read as signed out); it now
    says what was wrong;
  - an English message with a Chinese name in it ("Cancel 百度网盘SVIP", sent by the English Subscriptions page) got a
    Chinese reply; a message that mixes both now gets the app's language;
  - after bypass attempts, Qwen also marked the next plain request suspicious (it saw them in the history) and the card
    gave the bypass reason; the prompt now says to judge the latest message (checked once in the browser, not measured);
  - History showed no amount and no "on its way / returned" for transfers by phone number;
  - a saved payee's note used Chinese brackets in English; `favicon.ico` was missing (a 404 in the console).

- **Security review and full crawl (24 October, night):** a third security review (`docs/security_best_practices_report.md`):
  Pillow 12.3.0 had 37 advisories, two reaching the receipt-photo path (CPU denial of service, bounded by the worker's
  time limit); now Pillow 13.0.0 with only the PNG and JPEG readers allowed, plus certifi and opentelemetry-api patch
  updates (`pip-audit`: none left). The simulated WeChat credential is kept per tab (it was in localStorage); pages send
  a `Permissions-Policy`. Ownership checks on every id route, headers and the WeChat routes were tried against a
  running server. Not fixed, for the team to decide: Vite 5 / esbuild / Tailwind 3 advisories, which concern the
  development server and build tools, not the deployed app (each fix is a major upgrade). A crawl of every page in
  Chinese and English, desktop and phone: no console errors, failed requests, CSP violations or sideways scrolling;
  the How page's example now shows an English request and plan in English.
- **Every click leads somewhere (24 October, night):** every link on every page followed (all land on a page with
  content; sign-in and sign-up send a signed-in customer home), every button pressed in Chinese and English, and every
  sentence the app suggests (landing cards, assistant chips, hints, WeChat and History chips: 49) sent to the assistant:
  none gets the help text or an error. Fixed: History was an empty page for a new account (now it explains itself and
  offers three things to try); the simulated phones' empty inbox says what will appear; the Spending page's
  "Freeze card" button on a suspicious payment names the card it used (it asked "which card?").
- **Decks: a market slide and new screenshots (24 October, night):** slide 4 in all three decks, "市场：银行都在做 AI
  助手，缺的是守住钱的那一层" / "The market": why it matters (1.017 billion online payers, 258,000 telecom-fraud cases
  solved in 2025), why it helps ($200–340 billion a year for banking, McKinsey; 602 million generative-AI users), who
  builds it (ICBC, CMB, WeBank, Bank of America's Erica; the State Council's "AI+" opinion), each fact with its source on
  the slide and in [PITCH.md](PITCH.md). Every screenshot retaken from a fresh demo account (Chinese and English, 390 ×
  844 at 1.5×): the decks' 20 and the README's 8, plus the WeChat assistant as a seventh phone on the product slide;
  "next steps" now says a real Mini Program. 17 slides, notes 9:40. The plan-card screenshots (birthday, ¥200 and
  its done card, in Chinese and English) were retaken with Qwen on (7 paid calls, the team's OK), so they say the AI
  model planned them; Qwen's prompt now asks for its own labels (a reserve's name) in the customer's language (it
  had written 生日礼物 in an English plan).
  The three decks on claude.ai now match the repo (the same 17 slides and notes; the new screenshots uploaded to
  each deck, so `images.json` has their new ids).
- **Review and audit log in plain words (26 October):** the 24 October work reread; fixed the How page's English
  example, the risk count in PITCH.md (15), the WeChat page's wording for a link made in another tab, and the evidence
  slide's box colour (a 185→187 replace had changed `#185A2B`; restored in the repo, on claude.ai and in the PDFs).
  The audit log (History → 审计日志) and the request dialog now say each entry in words: the rule and signals that set
  a tier, the flags, the purpose chosen, the transfer's route and arrival, how it was approved. The codes stay under
  each entry in small type, as recorded. `GET /api/audit` sends the bank's own texts for the codes (`labels`), so the
  log matches the confirm cards; a test checks that every code those entries carry, and every screening flag, has one.
  The market slide's 10.17 亿 online-payment users (90.3%) was checked against the 57th CNNIC report itself (page 35).
- **Stress test and security review (27 October):** 56 held-out cases worded unlike the evaluation sets
  (offline: 28/40 requests, 16/16 attacks safe but 5 unflagged; Qwen: 16/16 attacks safe and flagged, 36/40 requests
  after two wrong expectations were corrected, the 4 misses all implied intent), races, OWASP API Top 10 probes,
  sandbox escapes, a git-history secret scan, Bandit, `pip-audit`, and a fresh clone built and run from the README.
  Method from the Anthropic Cybersecurity Skills library (community-made, Apache-2.0; not copied into the repo).
  Fixed: chat messages and SMS codes are rate-limited; a locked plan says so before any code is sent; the model's
  clarifying question may not ask for a secret or carry a link (`ASK_UNSAFE`). SECURITY (both languages) now maps the
  controls to OWASP LLM01/LLM02/LLM07:2025, the OWASP agentic AI threats, OWASP API1/4/5/6 and MITRE ATLAS; the review
  is SBP-10 to SBP-13 in `docs/security_best_practices_report.md`. Test count unchanged (187): the new checks extend
  existing tests.
- **What the stress test missed, fixed (27 October):** the offline planner (what answers when there is no model key,
  and what an evaluation run from the README gets) now reads the wordings it missed as general rules: “还剩几个钱”,
  “还有一百万” (no longer a repayment), “账单给我出一份”, rent said as “房租该交了”, “那笔撤回来”, “先停一下”, using a
  card abroad, “不看了，退了吧”, a reminder for a subscription called a 卡, “买啥好”. On the same 56 cases: 39/40 requests
  and 16/16 attacks, all flagged (this set is no longer held-out). Rent with no amount now takes the last rent from the
  bank's records, shown on the card as “与上次房租相同”. Qwen's prompt has rules for pausing a card, using a card abroad
  and rent with no amount; checked with Qwen on those four cases (4/4). The five attack phrasings the patterns missed are
  matched now. The 200-character brief is rewritten in plain words and names 通义千问 and WeChat ([BRIEF.md](BRIEF.md)).
  The team is **Callisto**: on the cover, team and closing slides and in the notes of all three decks.

## Still to do

1. **WeChat Mini Program** (later, for the final if the entry gets there): a real Mini Program on the same channel
   endpoint, with WeChat's signature check in place of the simulated credential. Needs WeChat DevTools and an AppID
   (the team's); publishing a bank Mini Program likely needs company qualifications.
2. **Demo video** (at most 5 minutes; listed with the deck in the official brief, so worth making): recorded by the team from [DEMO.md](DEMO.md), with Qwen on and at most
   five messages a minute (the key's limit).
3. **Submit** on the competition platform by 2 November (the team does this): the team name (Callisto), the project
   name and the 200-character brief ([BRIEF.md](BRIEF.md), the Chinese text), the 技术文档 and 安全自评 (as PDFs from
   `submission/build_docs.py`, or links), the PPT (PDF from `submission/build_slides.py`; a `.pptx` can be downloaded
   from the deck on claude.ai if a PowerPoint file is required), the repository link and, if made, the video.
4. Optional: a second full Qwen evaluation on the final prompt (`scripts/eval_model.py`: about 300 paid calls and 80
   minutes; ask the team first). If it runs, update its numbers everywhere they appear.

## Checks

Before any commit:

- `bash scripts/check.sh`: ruff, the tests, the evaluation sets with the offline planner and the frontend build. Free.
- The numbers in the docs and slides still match (`git grep` the old value after anything that moves one).
- No secrets: `.env` is never committed, and the API key lives only in environment variables.

Before submitting:

- With Qwen configured: `cd backend && uv run python ../scripts/qwen_check.py` says `planned by: ai (qwen3.8-max)`.
- The demo works end to end (DEMO.md): the coffee question answers for the last 12 months; 给妈妈转200 gives a yellow
  card that confirms; 给周凯转800 gives a red card (name mismatch, two-hour delay, what it's for); three bypass attempts
  trip the safety lock; the 多件事一起办 shortcut gives the four-step birthday plan; "show all my transactions" pages
  through everything; the Spending calendar opens on the latest day with spending.
- The PDFs: each line the builders print lists Noto Sans SC (Chinese) or DM Sans (English deck) under fonts loaded, and
  no broken images.
- No placeholders left except the team ones (`git grep -n "\[to fill\]\|\[待填入\]"` finds nothing).
- The speaker notes still add up to 10 minutes or less.

## Known gaps and decisions

- The bank is simulated: no real money moves (stated in the docs and the app).
- The TokenRouter key allows about 5 requests a minute: enough for a demo, not for many judges at once. Without the key
  the offline planner answers and everything still works.
- `react-router` 6.x has two moderate `npm audit` advisories; judged not exploitable here (hash routes, no server
  rendering). The fix is a breaking upgrade to v7, left by the team's decision (22 October).
- Vite 5 / esbuild (high) and Tailwind 3 / PostCSS (moderate) `npm audit` advisories concern the development server and
  the build, not the deployed app; each fix is a major upgrade. Left as they are by the team's decision (24 October);
  don't run `npm run dev` on a shared network.
- The market slide's McKinsey figure was confirmed through finews.asia (mckinsey.com was down) and WeBank's "800+ AI
  agents" comes from a newspaper quoting bank staff; the team chose to keep both (24 October).
- The last pre-push `npm audit` (24 October) couldn't reach the registry, so it didn't run.
- The Qwen numbers come from the run before the last prompt fixes (see above).
- The card, invest and subscription buttons send a sentence to the assistant: **Buy** always asks for ¥5,000 and
  **Redeem** for ¥1,000 (the confirm card shows it and can be cancelled), and each tap is a model call when Qwen is on.
- In English, transaction lists show counterparties as the bank recorded them (Chinese names such as 美团外卖, 刘洋),
  as a Chinese bank statement would; payee and product pages use their English names.
- Transfers that were returned or cancelled still count towards the day's ¥1,000 total (the stricter reading).

## Rules

The rules in [../AGENTS.md](../AGENTS.md) apply. In short: the model never decides anything about money; never commit
secrets; ask before any paid model call; no public CDNs in the app; every user-facing string in Chinese and English;
the tier thresholds match the brief exactly.

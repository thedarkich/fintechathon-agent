# Project status (24 October 2026)

For whoever continues the work, a person or a Claude Code session. Keep this file current: when something here changes,
change it here too.

## The competition

- 2026 Shenzhen International FinTech Competition (FinTechathon), **Domestic AI Track: Banking AI Agent**. The bank in
  the entry is 中联银行 / Central Union Bank.
- **Submission deadline: 2 November 2026.** Until then the entry can be improved and resubmitted; the last valid
  submission counts.
- **Online review: 3–8 November 2026**; the top ten go on to the final.
- The team has three members; the pitch is in Chinese.

## The required materials: read this before changing anything

The organisers list five items. Four are required (必交), one is optional (可选):

| Item | Required | Status | Where |
|---|---|---|---|
| **技术文档**: architecture diagram, algorithm description, security design | 必交 | Done | [ARCHITECTURE.zh.md](ARCHITECTURE.zh.md) ([English](ARCHITECTURE.md)): §一 architecture with [img/architecture.svg](img/architecture.svg), §二 a request end to end, §三 eleven core algorithms; [SECURITY.zh.md](SECURITY.zh.md) for the security design |
| **答辩 PPT**: the talk is **at most 10 minutes** | 必交 | Done except the team details | [../submission/slides](../submission/slides) (three decks of 16 slides; speaker notes total **9:00**) and the same decks on claude.ai |
| **源代码**: README, repository, deployment guide and test cases | 必交 | Done | public repo https://github.com/thedarkich/fintechathon-agent; [../README.zh.md](../README.zh.md) / [../README.md](../README.md) (with 部署 / Deploy); [../deploy](../deploy); [../backend/tests](../backend/tests); [../evals](../evals) |
| **安全自评**: permission tiers and the list of known risks | 必交 | Done | [SECURITY.zh.md](SECURITY.zh.md) §2.1 (the three tiers) and §四 (14 known risks) |
| **演示视频**: **at most 5 minutes** | 可选 | Not recorded | script: [DEMO.md](DEMO.md) |

Hard limits that come from these criteria:

- The talk must fit in **10 minutes**. The speaker notes add up to 9:00 (each `<aside>` starts with its time). Don't
  add slides or notes that push it past 10.
- The video, if there is one, is **5 minutes at most**.
- Everything is in by **2 November**.
- The documents must match the code: every number they quote is measured (next section).

## Measured numbers (quote these and nothing else)

- **173 automated tests** (`bash scripts/check.sh` runs them).
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
  the architecture docs; the pitch outline for the 9-minute talk; the demo script records with Qwen on.
- **Slides:** three decks (Chinese for reading, Chinese for presenting, English), 16 slides, 9:00 of notes, AI-forward
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

## Still to do

1. **Team details in the slides** (all three decks: cover, team and closing slides): the team name, the three members'
   names and one-line roles, and the school. Only the team can supply these; don't invent them. Then rebuild the PDFs
   (`submission/build_slides.py`) and make the same change in the decks on claude.ai.
2. **Demo video** (optional, at most 5 minutes): recorded by the team from [DEMO.md](DEMO.md), with Qwen on and at most
   five messages a minute (the key's limit).
3. **Submit** on the competition platform by 2 November (the team does this): the 技术文档 and 安全自评 (as PDFs from
   `submission/build_docs.py`, or links), the PPT (PDF from `submission/build_slides.py`; a `.pptx` can be downloaded
   from the deck on claude.ai if a PowerPoint file is required), the repository link and, if made, the video.
4. Optional: a second full Qwen evaluation on the final prompt (`scripts/eval_model.py`: about 300 paid calls and 80
   minutes; ask the team first). If it runs, update its numbers everywhere they appear.
5. Optional: retake the README screenshots in `docs/img/screens` (taken 22 October) if the app no longer looks like them.

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
- The last pre-push `npm audit` (24 October) couldn't reach the registry, so it didn't run.
- The Qwen numbers come from the run before the last prompt fixes (see above).

## Rules

The rules in [../AGENTS.md](../AGENTS.md) apply. In short: the model never decides anything about money; never commit
secrets; ask before any paid model call; no public CDNs in the app; every user-facing string in Chinese and English;
the tier thresholds match the brief exactly.

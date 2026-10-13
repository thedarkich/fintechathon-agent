# Pitch outline (10-minute talk)

Draft slide by slide. Speaker time in brackets. The demo can be live with the video as backup.

1. **Title** (0:20). Name (to be decided), one line: “AI 只提议，规则做决定 / The AI proposes. The rules decide.” Team.
2. **The problem** (0:50). Mobile banking hides simple tasks behind deep menus; the brief notes a transfer takes three or more steps. Agents can now act on a customer's behalf, so the hard question is control: who decides that money moves?
3. **Our principle** (0:50). One diagram: words → AI plan (closed catalogue of 41 actions) → code checks against the customer's records → green / yellow / red → the customer's approval → bank → reply written by code. The model never sees account data, never approves, never writes a number.
4. **Demo** (4:00). Live, or the 5-minute video cut to 4 ([DEMO.md](DEMO.md)): a sandboxed spending question, a yellow transfer, the red transfer to a new seller that is delayed and returned for a name mismatch, the blocked injection and the safety lock, and the birthday plan.
5. **Permission tiers, exactly as the brief** (0:40). Table: green, yellow and red with the ¥1,000 daily total (counted across requests, scheduled payments and plan steps), signals that only raise, approval bound to a hash, PIN plus SMS or passkey.
6. **Security in layers** (0:50). Screening → closed plan schema → tiers in code → approval hash → strong verification → delayed arrival and name check → safety lock → hash-chained audit. Make the point that even an attack screening misses (look-alike letters) still lands on a slip at the right tier.
7. **Built for banks in China** (0:40). Same-bank and 超级网银 routes; instant, 2-hour or next-day arrival as PBOC notice 261号 requires, with cancellation; name check and returns; RMB in fen; no CDNs; any OpenAI-compatible model, including providers hosted in China; works fully offline with the rule-based planner.
8. **Evidence** (0:40). 73 automated tests; 178 everyday requests and 55 attacks run on fresh customers, all passing with the offline planner; no attack ran anything without approval. Say plainly what isn't measured yet (the model planner).
9. **Honest risks** (0:30). Three from [SECURITY.md](SECURITY.md): SMS is a weak factor (prefer passkeys), a coached customer can still approve (mitigated by delays and name checks), and the bank is simulated.
10. **What's next** (0:30). Plug a real payment API into the one transfer module; measure the model planner; an IM channel that hands red steps back to the app; per-operator two-factor authentication.
11. **Close** (0:10). The one line again, and the ask.

Visual style: the app's own look (ruled panels, the 审批栏 sign-off row, red seals), with one idea per slide and Chinese first, English second, if the talk is bilingual.

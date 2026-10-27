# Submission materials

What the competition asks for (submission deadline 2 November; online review 3–8 November) and where each piece is:

| Required | Where |
|---|---|
| 技术文档: architecture diagram, algorithms, security design | [docs/ARCHITECTURE.zh.md](../docs/ARCHITECTURE.zh.md) ([English](../docs/ARCHITECTURE.md)) with [docs/img/architecture.svg](../docs/img/architecture.svg); [docs/SECURITY.zh.md](../docs/SECURITY.zh.md) |
| 答辩 PPT: a talk of at most 10 minutes | [slides/](slides): `zh-submission` (more text, for reading), `zh-live` (for presenting), `en-live`; 17 slides each, speaker notes totalling 9:40 |
| 源代码: README, repository, deployment guide, tests | [README.zh.md](../README.zh.md) / [README.md](../README.md), [deploy/](../deploy), [backend/tests](../backend/tests), [evals/](../evals) |
| 安全自评: permission tiers, known risks | [docs/SECURITY.zh.md](../docs/SECURITY.zh.md) §2.1 (tiers) and §四 (known risks) |
| 演示视频 (optional): at most 5 minutes | script: [docs/DEMO.md](../docs/DEMO.md) |

## Build the PDFs

```bash
cd backend && uv sync
uv run python ../submission/build_slides.py   # the three decks, one slide per page, and a contact sheet each -> submission/pdf/
uv run python ../submission/build_docs.py     # README, 技术文档, 安全自评, Chinese and English -> submission/pdf/docs/
```

Both need Chrome or Chromium (set `CHROME` to its path if they don't find one). Fonts come from Google Fonts: each line
the scripts print says which fonts loaded. The Chinese PDFs need **Noto Sans SC** in that list (the English deck DM
Sans); without it Chinese falls back to whatever the machine has, or to empty boxes. `submission/pdf/` is git-ignored.

## The slide files

Each deck is `deck.json` (title, slide order, sections, fonts) and `slides/<id>.html`, copied from the Slides decks on
claude.ai. Images are referenced as `/_blob/<id>`; [slides/images.json](slides/images.json) maps each to a file in
[slides/images](slides/images). Each slide's speaker notes are its `<aside>`, which the PDFs leave out. A change made
here doesn't reach the decks on claude.ai (or the other way round), so make it in both.

The four members, their roles and schools are on the cover, team and closing slides of all three decks. Still to fill
in: the team name, in the cover slide's speaker notes (`[队名]`, `[team name]`).

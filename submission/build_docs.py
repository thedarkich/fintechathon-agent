"""The submission documents as PDFs, Chinese and English: the README, the technical document (architecture and
algorithms) and the security design and self-assessment, rendered from the repo's Markdown by headless Chrome. Links to
other repo files point at the public GitHub repo; images are local copies. The Mermaid text version of the architecture
diagram is left out (GitHub draws it; a PDF would print raw code, and the same diagram is right above it as an image).

    cd backend && uv run python ../submission/build_docs.py        # writes submission/pdf/docs/
"""
import asyncio
import base64
import posixpath
import re
import shutil
import subprocess
import sys
from pathlib import Path

import markdown
from cdp import Chrome

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
GITHUB = "https://github.com/thedarkich/fintechathon-agent"
OUT = HERE / "pdf" / "docs"
ASSETS = OUT / "assets"
COMMIT = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()

DOCS = [  # source, language, short name for the footer, file name
    ("README.zh.md", "zh", "项目说明（README）", "中联银行-项目说明-README"),
    ("README.md", "en", "Project overview (README)", "Central-Union-Bank-README"),
    ("docs/ARCHITECTURE.zh.md", "zh", "技术文档", "中联银行-技术文档"),
    ("docs/ARCHITECTURE.md", "en", "Technical documentation", "Central-Union-Bank-technical-documentation"),
    ("docs/SECURITY.zh.md", "zh", "安全设计与安全自评", "中联银行-安全设计与安全自评"),
    ("docs/SECURITY.md", "en", "Security design and self-assessment", "Central-Union-Bank-security-self-assessment"),
]

CSS = """
@page { size: A4; margin: 18mm 17mm 20mm }
:root { --ink: #13221B; --ink2: #4A5A52; --line: #DCE3DF; --soft: #F4F7F5; --green: #1A7F4F; --deep: #0F2A1F }
html { font-family: 'DM Sans', 'Noto Sans SC', 'Microsoft YaHei', sans-serif; color: var(--ink); font-size: 10.5pt;
       line-height: 1.6; -webkit-print-color-adjust: exact; print-color-adjust: exact }
html[lang=zh-CN] { font-family: 'Noto Sans SC', 'Microsoft YaHei', 'DM Sans', sans-serif; line-height: 1.75 }
body { margin: 0 }
.band { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: var(--deep); color: #EEF5F1;
        border-radius: 10px; margin-bottom: 6px }
.band img { width: 34px; height: 34px; background: #FBFCFA; border-radius: 8px; padding: 4px }
.band b { font-size: 12.5pt; letter-spacing: .02em; white-space: nowrap; flex: none }
.band span { margin-left: auto; font-size: 9pt; line-height: 1.35; color: #A8C5B6; text-align: right; max-width: 48% }
.meta { font-size: 8.5pt; color: var(--ink2); margin: 0 0 18px 2px }
.meta a { color: var(--ink2) }
h1 { font-size: 21pt; line-height: 1.25; margin: 10px 0 10px; color: var(--deep) }
h2 { font-size: 14pt; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--green); color: var(--deep);
     break-after: avoid }
h3 { font-size: 11.5pt; margin: 18px 0 6px; color: var(--green); break-after: avoid }
h4 { font-size: 10.5pt; margin: 14px 0 4px; break-after: avoid }
p, li { orphans: 3; widows: 3 }
ul, ol { padding-left: 1.4em }
li { margin: 2px 0 }
a { color: var(--green); text-decoration: none; word-break: break-word }
strong { color: var(--deep) }
code { font-family: Consolas, 'Cascadia Mono', monospace; font-size: 9pt; background: var(--soft); border: 1px solid var(--line);
       border-radius: 4px; padding: 0 3px; word-break: break-word }
pre { background: var(--soft); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; overflow: hidden;
      white-space: pre-wrap; break-inside: avoid; font-size: 8.8pt; line-height: 1.5 }
pre code { background: none; border: 0; padding: 0 }
table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 9pt; line-height: 1.5 }
th { background: var(--soft); text-align: left; font-weight: 700 }
th, td { border: 1px solid var(--line); padding: 5px 7px; vertical-align: top }
tr { break-inside: avoid }
img { max-width: 100% }
p > img[src$=".svg"] { display: block; width: 100%; margin: 8px 0; break-inside: avoid }
p[align=center] { display: flex; gap: 8px; justify-content: center; break-inside: avoid }
p[align=center] img { width: 23%; height: auto; border: 1px solid var(--line); border-radius: 8px }
blockquote { margin: 10px 0; padding: 6px 12px; border-left: 3px solid var(--green); background: var(--soft); color: var(--ink2) }
hr { border: 0; border-top: 1px solid var(--line); margin: 18px 0 }
"""

FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700'
         '&family=Noto+Sans+SC:wght@400;500;700&display=swap">')


def local_asset(repo_path: str) -> str:
    target = ASSETS / repo_path
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(REPO / repo_path, target)
    return target.resolve().as_uri()


def relink(html: str, doc_dir: str) -> str:
    def resolve(value: str) -> str:
        return posixpath.normpath(posixpath.join(doc_dir, value)) if doc_dir else posixpath.normpath(value)

    def src(match):
        value = match.group(2)
        if re.match(r"[a-z]+:", value):
            return match.group(0)
        return f'{match.group(1)}"{local_asset(resolve(value))}"'

    def href(match):
        value = match.group(2)
        if re.match(r"[a-z]+:|#", value):
            return match.group(0)
        path, _, anchor = value.partition("#")
        full = resolve(path)
        kind = "tree" if (REPO / full).is_dir() else "blob"
        return f'{match.group(1)}"{GITHUB}/{kind}/main/{full}{"#" + anchor if anchor else ""}"'

    html = re.sub(r'(<img[^>]*?\ssrc=)"([^"]+)"', src, html)
    return re.sub(r'(<a[^>]*?\shref=)"([^"]+)"', href, html)


def build(source: str, lang: str, short: str, name: str) -> Path:
    text = (REPO / source).read_text(encoding="utf-8")
    # the Mermaid text version of the architecture diagram: GitHub draws it, a PDF would print raw code, and the same
    # diagram is right above it as an image
    text, dropped = re.subn(r"\n(The same structure as text:|同一结构的文字版：)\n+```mermaid\n.*?\n```\n", "\n", text, flags=re.S)
    if "```mermaid" in text:
        raise SystemExit(f"{source}: a Mermaid block is left")
    body = markdown.markdown(text, extensions=["extra", "sane_lists"], output_format="html")
    body = relink(body, posixpath.dirname(source))
    logo = local_asset("frontend/public/logo.svg")
    if lang == "zh":
        band = f'<div class="band"><img src="{logo}" alt=""><b>中联银行 AI 助手</b><span>FinTechathon 2026 · {short}</span></div>'
        meta = f'代码仓库：<a href="{GITHUB}">github.com/thedarkich/fintechathon-agent</a>　·　版本 {COMMIT}　·　2026 年 10 月'
    else:
        band = f'<div class="band"><img src="{logo}" alt=""><b>Central Union Bank AI assistant</b><span>FinTechathon 2026 · {short}</span></div>'
        meta = f'Repository: <a href="{GITHUB}">github.com/thedarkich/fintechathon-agent</a>　·　version {COMMIT}　·　October 2026'
    page = (f'<!doctype html><html lang="{"zh-CN" if lang == "zh" else "en"}"><head><meta charset="utf-8">'
            f'<title>{short}</title>{FONTS}<style>{CSS}</style></head><body>{band}<p class="meta">{meta}</p>{body}</body></html>')
    path = OUT / f"{name}.html"
    path.write_text(page, encoding="utf-8")
    return path


def footer(lang: str, short: str) -> str:
    brand = "中联银行 AI 助手" if lang == "zh" else "Central Union Bank AI assistant"
    return ('<div style="font-size:7.5pt;color:#6B7A72;width:100%;padding:0 17mm;display:flex;'
            "font-family:'Noto Sans SC','Microsoft YaHei',sans-serif\">"
            f'<span>{brand} · {short}</span><span style="margin-left:auto"><span class="pageNumber"></span> / '
            '<span class="totalPages"></span></span></div>')


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with Chrome() as chrome:
        for source, lang, short, name in DOCS:
            page = build(source, lang, short, name)
            seen = await chrome.open(page)
            pdf = await chrome.send("Page.printToPDF", printBackground=True, preferCSSPageSize=True, displayHeaderFooter=True,
                                    headerTemplate="<span></span>", footerTemplate=footer(lang, short),
                                    marginTop=0.7, marginBottom=0.8, marginLeft=0.67, marginRight=0.67)
            target = OUT / f"{name}.pdf"
            target.write_bytes(base64.b64decode(pdf["data"]))
            print(f"{target.name}: {target.stat().st_size // 1024} KB | fonts loaded: {seen['fonts']} | broken images: {seen['broken']}")


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    asyncio.run(main())

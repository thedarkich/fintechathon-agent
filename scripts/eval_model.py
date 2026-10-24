"""The evaluation sets with the AI planner the environment configures, paced to the key's 5 requests a minute and
saved case by case, so an interrupted run resumes where it stopped instead of paying for the same cases again. Same
cases, steps and checks as app.evals; a rate-limit refusal waits and retries (it isn't a paid call). Writes
docs/eval/report-model.md and results-model.json when every case is done. PAID: about 300 calls, about 80 minutes.

    cd backend && LLM_ENABLED=true LLM_HOURLY_CALL_CAP=1000 uv run python ../scripts/eval_model.py
    EVAL_IDS=ana-01,trf-01 ...   only these cases (no report files)
    EVAL_PROGRESS=path           where the per-case progress is kept (default: the temp folder)
"""
import asyncio
import json
import os
import tempfile
import time
import uuid
from collections import Counter, defaultdict
from pathlib import Path

from fastapi.testclient import TestClient
from openai import APIConnectionError, APIStatusError, APITimeoutError, RateLimitError
from openai.resources.chat.completions import AsyncCompletions
from sqlalchemy import delete
from sqlmodel import Session

from app.config import Settings
from app.evals import ORIGIN, check, confirm, language, markdown, reply_of
from app.main import create_app
from app.models import RateBucket
from app.runtime import Runtime

assert os.environ.get("LLM_ENABLED") == "true", "run with LLM_ENABLED=true"
assert int(os.environ.get("LLM_HOURLY_CALL_CAP", "0")) >= 500, "raise LLM_HOURLY_CALL_CAP for this run"

ROOT = Path(__file__).resolve().parents[1]
SETS = [ROOT / "evals" / "intent.jsonl", ROOT / "evals" / "attacks.jsonl"]
PROGRESS = Path(os.environ.get("EVAL_PROGRESS", Path(tempfile.gettempdir()) / "bank-agent-eval-model.jsonl"))
LIMIT = int(os.environ.get("EVAL_LIMIT", "0"))  # a sample: only the first N cases, and no report files
OUT = ROOT / "docs" / "eval"
GAP = 13.5  # seconds between call starts: a little under 5 a minute
state = {"last": time.time() + 55, "calls": 0, "limited": 0, "started": time.time()}
real = AsyncCompletions.create


def minutes():
    return f"{(time.time() - state['started']) / 60:.0f} min"


async def paced(self, **kwargs):
    error = None
    for _ in range(4):
        wait = state["last"] + GAP - time.time()
        if wait > 0:
            await asyncio.sleep(wait)
        state["last"] = time.time()
        try:
            began = time.time()
            response = await real(self, **kwargs)
            state.setdefault("latency", []).append(time.time() - began)
            state["calls"] += 1
            return response
        except RateLimitError as exc:
            error = exc
            state["limited"] += 1
            state["last"] = time.time() + 30 - GAP
        except APITimeoutError:
            print(f"[{minutes()}] provider timeout: this case falls back (not retried: it may have been billed)", flush=True)
            raise
        except (APIStatusError, APIConnectionError) as exc:
            # a provider outage or error: wait a minute and try again rather than measure the offline fallback
            error = exc
            state["errors"] = state.get("errors", 0) + 1
            print(f"[{minutes()}] provider error {type(exc).__name__} {getattr(exc, 'status_code', '')}: {str(exc)[:160]}; retrying in 60 s", flush=True)
            state["last"] = time.time() + 60 - GAP
    print(f"[{minutes()}] gave up after 4 tries: this case falls back", flush=True)
    raise error


AsyncCompletions.create = paced

done = {}
if PROGRESS.exists():
    for line in PROGRESS.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            done[(r["set"], r["id"])] = r
cases = [(path.stem, json.loads(line)) for path in SETS for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
IDS = {i for i in os.environ.get("EVAL_IDS", "").split(",") if i}  # a smoke test of these ids only, no report files
if IDS:
    cases = [c for c in cases if c[1]["id"] in IDS]
    LIMIT = len(cases)
if LIMIT:
    cases = cases[:LIMIT]
print(f"started {time.strftime('%H:%M:%S')}: {len(done)} of {len(cases)} cases already done", flush=True)

with tempfile.TemporaryDirectory(prefix="bank-eval-") as directory:
    settings = Settings(data_dir=Path(directory), static_dir=Path(directory) / "none", public_base_url="http://testserver",
                        ip_hash_salt="eval-salt-0123456789abcdef0123456789", demo_tools_enabled=True,
                        _env_file=Settings.model_config["env_file"])
    runtime = Runtime(settings, background=False)
    planner = "model" if runtime.planner.online else "offline"
    assert planner == "model", "the model planner is not switched on"
    with TestClient(create_app(runtime=runtime)) as client, PROGRESS.open("a", encoding="utf-8") as progress:
        for n, (name, case) in enumerate(cases, 1):
            if (name, case["id"]) in done:
                continue
            with Session(runtime.engine) as session:
                session.execute(delete(RateBucket))
                session.commit()
            client.cookies.clear()
            client.post("/api/register", json={"name": "Eval Customer", "email": f"eval-{uuid.uuid4().hex[:10]}@example.test",
                                               "password": "evaluation password", "pin": "246813"}, headers=ORIGIN)
            for text in case.get("before", []):
                earlier = client.post("/api/chat", json={"message": text, "lang": language(text)}, headers=ORIGIN).json()
                confirm(client, earlier.get("plan"), language(text))
            attachment = None
            if case.get("attachment"):
                file = ROOT / case["attachment"]
                attachment = client.post("/api/uploads", files={"file": (file.name, file.read_bytes(), "application/pdf")},
                                         headers=ORIGIN).json()["id"]
            response = client.post("/api/chat", json={"message": case["text"], "lang": language(case["text"]),
                                                      "attachment_id": attachment}, headers=ORIGIN)
            body = response.json() if response.status_code == 200 else {}
            problems = check(case, body, runtime.engine, client) if body else [f"HTTP {response.status_code}"]
            plan = body.get("plan")
            result = {"set": name, "id": case["id"], "category": case["category"], "text": case["text"],
                      "passed": not problems, "problems": problems,
                      "got": {"actions": [s["action"] for s in plan["steps"]] if plan else [],
                              "tier": plan["tier"] if plan else None,
                              "status": plan["status"] if plan else "none",
                              "source": plan["source"] if plan else None,
                              "reply": reply_of(body)[:200] if body else ""}}
            progress.write(json.dumps(result, ensure_ascii=False) + "\n")
            progress.flush()
            done[(name, case["id"])] = result
            if n % 10 == 0:
                print(f"[{minutes()}] {len(done)}/{len(cases)} cases, {state['calls']} calls this run, "
                      f"{state['limited']} rate-limit waits, {state.get('errors', 0)} provider errors, last: {result['got']['source']}", flush=True)

lat = sorted(state.get("latency", []))
if lat:
    print(f"latency of answered calls: n={len(lat)} median={lat[len(lat) // 2]:.1f}s p90={lat[int(len(lat) * 0.9)]:.1f}s max={lat[-1]:.1f}s", flush=True)
results = [done[(name, case["id"])] for name, case in cases]
if LIMIT:
    print(f"sample of {len(results)}: passed {sum(r['passed'] for r in results)}, by the model {sum(r['got']['source'] == 'ai' for r in results)}, "
          f"sources {dict(Counter(r['got']['source'] for r in results))}")
    raise SystemExit(0)
summary = defaultdict(lambda: {"cases": 0, "passed": 0})
for r in results:
    for key in (r["set"], f"{r['set']}/{r['category']}"):
        summary[key]["cases"] += 1
        summary[key]["passed"] += r["passed"]
report = {"planner": "model", "results": results, "summary": dict(summary)}
sources = Counter(r["got"]["source"] for r in results)
by_set = {s: dict(Counter(r["got"]["source"] for r in results if r["set"] == s)) for s in ("intent", "attacks")}
note = (f"\n## Who planned each case\n\nModel `{settings.ai_model}` at `{settings.ai_base_url}`, paced to 5 requests a minute. "
        f"Sources: {dict(sources)} (`ai` = the model's plan; `offline_fallback` = the model call failed and the offline "
        f"planner answered; `followup` = settled by code before any model call; `None` = no plan was made, for example because the model asked a question; the reply is in results-model.json). Per set: {by_set}.\n")
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "results-model.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
(OUT / "report-model.md").write_text(markdown(report) + note, encoding="utf-8")
for key, value in sorted(report["summary"].items()):
    if "/" not in key:
        print(f"{key}: {value['passed']}/{value['cases']}")
print("sources:", dict(sources), "| per set:", by_set)
print("failures:")
for r in results:
    if not r["passed"]:
        print(f"  [{r['set']}/{r['id']}] {r['text'][:50]} | source={r['got']['source']} | {'; '.join(r['problems'])} | reply: {r['got'].get('reply', '')[:80]}")
print(f"done in {minutes()}, {state['calls']} calls this run, {state['limited']} rate-limit waits")

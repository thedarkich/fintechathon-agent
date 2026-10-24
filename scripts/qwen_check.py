"""One request through the app with the AI planner the environment configures (LLM_ENABLED, AI_BASE_URL, AI_API_KEY,
AI_MODEL, LLM_THINKING), on a throwaway demo customer: says who planned it, so a new place the app runs (a Claude Code
cloud session, a server) can confirm the model answers. One paid model call.

    cd backend && uv run python ../scripts/qwen_check.py ["给妈妈转200"]
"""
import sys
import tempfile
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import Settings
from app.evals import ORIGIN, language
from app.main import create_app
from app.models import AuditEntry
from app.runtime import Runtime

text = sys.argv[1] if len(sys.argv) > 1 else "给妈妈转200"
with tempfile.TemporaryDirectory(prefix="qwen-check-") as directory:
    settings = Settings(data_dir=Path(directory), static_dir=Path(directory) / "none", public_base_url="http://testserver",
                        ip_hash_salt="check-salt-0123456789abcdef0123456789")
    runtime = Runtime(settings, background=False)
    if not runtime.planner.online:
        sys.exit("The AI planner is off: set LLM_ENABLED=true, AI_BASE_URL, AI_API_KEY and AI_MODEL in the environment.")
    with TestClient(create_app(runtime=runtime)) as client:
        client.post("/api/register", json={"name": "Model Check", "email": f"check-{uuid.uuid4().hex[:10]}@example.test",
                                           "password": "model check password", "pin": "246813"}, headers=ORIGIN)
        body = client.post("/api/chat", json={"message": text, "lang": language(text)}, headers=ORIGIN).json()
        with Session(runtime.engine) as session:
            failures = [a.data for a in session.exec(select(AuditEntry).where(AuditEntry.kind == "model_unavailable"))]
plan = body.get("plan") or {}
print(f"request: {text}")
print(f"planned by: {plan.get('source')} ({plan.get('model') or 'no model'}); steps: {[s['action'] for s in plan.get('steps', [])]}")
if failures:
    print(f"the model call failed, so the built-in rules planned it: {failures}")
sys.exit(0 if plan.get("source") == "ai" else 1)

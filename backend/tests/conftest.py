import re

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.config import Settings
from app.main import create_app
from app.models import SmsMessage
from app.runtime import Runtime

ORIGIN = {"Origin": "http://testserver"}
PIN = "246813"
CUSTOMER = {"name": "Li Ming", "email": "li.ming@example.com", "password": "correct horse battery", "pin": PIN}


def settings(tmp_path, **overrides):
    return Settings(_env_file=None, data_dir=tmp_path, static_dir=tmp_path / "static", admin_token="t" * 40,
                    ip_hash_salt="s" * 40, public_base_url="http://testserver", passkey_rp_id="testserver",
                    llm_enabled=False, **overrides)


class Bank:
    """A signed-in customer talking to the app through HTTP, as the frontend does."""

    def __init__(self, client: TestClient, runtime: Runtime):
        self.client, self.runtime = client, runtime
        self.conversation = None

    def post(self, path, json=None):
        return self.client.post(path, json=json or {}, headers=ORIGIN)

    def get(self, path, **params):
        return self.client.get(path, params=params)

    def chat(self, message, lang="zh"):
        response = self.post("/api/chat", {"message": message, "conversation_id": self.conversation, "lang": lang})
        assert response.status_code == 200, response.text
        body = response.json()
        self.conversation = body["conversation_id"]
        return body

    def approve(self, plan):
        return self.post(f"/api/plans/{plan['id']}/approve", {"approval_hash": plan["approval_hash"]})

    def purpose(self, plan, value="goods", step="s1"):
        """Say what a risky payment is for, as the customer does on the slip; returns the re-checked plan."""
        response = self.post(f"/api/plans/{plan['id']}/purpose", {"step_id": step, "purpose": value})
        assert response.status_code == 200, response.text
        body = response.json()
        # the card shows the re-checked plan: no second copy of it in the chat while it waits
        assert body["plan"]["status"] != "awaiting_approval" or body["messages"] == []
        return body["plan"]

    def sms_code(self):
        with Session(self.runtime.engine) as session:
            message = session.exec(select(SmsMessage).order_by(SmsMessage.at.desc()).limit(1)).first()
            return re.search(r"\d{6}", message.text).group(0)

    def verify(self, plan, *, pin=PIN, code=None, **extra):
        challenge = self.post(f"/api/plans/{plan['id']}/sms").json()
        return self.post(f"/api/plans/{plan['id']}/verify", {
            "approval_hash": plan["approval_hash"], "pin": pin, "method": "sms",
            "challenge_id": challenge["challenge_id"], "code": code or self.sms_code(), **extra})


@pytest.fixture
def bank(tmp_path):
    runtime = Runtime(settings(tmp_path), background=False)
    client = TestClient(create_app(runtime=runtime), raise_server_exceptions=True)
    with client:
        response = client.post("/api/register", json=CUSTOMER, headers=ORIGIN)
        assert response.status_code == 201, response.text
        yield Bank(client, runtime)

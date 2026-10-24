"""Security hardening from docs/security_best_practices_report.md (SBP-1, SBP-3, SBP-4, SBP-5)."""

import base64
import hashlib

from fastapi.testclient import TestClient

from app.main import create_app
from app.runtime import Runtime
from tests.conftest import CUSTOMER, ORIGIN, settings

EVIL = {"Origin": "https://evil.example"}


def app_client(tmp_path, **overrides):
    return TestClient(create_app(runtime=Runtime(settings(tmp_path, **overrides), background=False)))


def test_public_account_routes_refuse_another_site(tmp_path):
    # SBP-3: sign-in, sign-up, demo and sign-out from another site's page are refused
    with app_client(tmp_path) as client:
        for path, body in [("/api/register", CUSTOMER), ("/api/demo/start", {"lang": "zh"}),
                           ("/api/login", {"email": CUSTOMER["email"], "password": CUSTOMER["password"]}), ("/api/logout", {})]:
            assert client.post(path, json=body, headers=EVIL).status_code == 403, path
        # this site, and scripts that send no Origin, still work
        assert client.post("/api/register", json=CUSTOMER, headers=ORIGIN).status_code == 201
        assert client.post("/api/logout", json={}).status_code == 200
        assert client.post("/api/login", json={"email": CUSTOMER["email"], "password": CUSTOMER["password"]}).status_code == 200


def test_api_docs_follow_the_demo_tools_switch(tmp_path):
    # SBP-4: a deployment for real customers (demo tools off) doesn't publish the API docs
    with app_client(tmp_path / "off", demo_tools_enabled=False) as client:
        for path in ("/api/docs", "/api/openapi.json", "/api/docs/oauth2-redirect", "/docs/oauth2-redirect"):
            assert client.get(path).status_code == 404, path
    with app_client(tmp_path / "on") as client:
        assert client.get("/api/openapi.json").status_code == 200


def logins(client, count, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return [client.post("/api/login", json={"email": f"nobody{i}@example.com", "password": "wrong password!"},
                        headers=headers).status_code for i in range(count)]


def test_sign_in_attempts_are_limited_per_visitor_ip(tmp_path):
    # SBP-5: behind the proxy, the visitor's address (the proxy's last X-Forwarded-For entry) is limited,
    # however many emails or device ids are tried
    with app_client(tmp_path / "proxy", behind_proxy=True) as client:
        codes = logins(client, 61, ip="203.0.113.7")
        assert codes[:60] == [401] * 60 and codes[60] == 429
        assert logins(client, 1, ip="198.51.100.9") == [401]  # someone else is not affected
    # not behind a proxy, a client-supplied X-Forwarded-For is ignored: rotating it doesn't reset the count
    with app_client(tmp_path / "direct") as client:
        codes = [client.post("/api/login", json={"email": f"n{i}@example.com", "password": "wrong password!"},
                             headers={"X-Forwarded-For": f"192.0.2.{i}"}).status_code for i in range(61)]
        assert codes[60] == 429


def test_pages_carry_a_content_security_policy(tmp_path):
    # SBP-1: the app shell may run only its own scripts and the one inline script it ships
    static = tmp_path / "static"
    static.mkdir()
    inline = "\n      try { document.documentElement.dataset.theme = 'dark' } catch (e) {}\n    "
    (static / "index.html").write_text(f"<!doctype html><html><head><script>{inline}</script>"
                                       f"<script type=\"module\" src=\"/assets/app.js\"></script></head><body></body></html>",
                                       encoding="utf-8")
    digest = base64.b64encode(hashlib.sha256(inline.encode()).digest()).decode()
    with app_client(tmp_path) as client:
        policy = client.get("/").headers.get("content-security-policy", "")
        assert f"script-src 'self' 'sha256-{digest}'" in policy
        for part in ("default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "connect-src 'self'"):
            assert part in policy, part
        # features the bank never uses are off; the microphone (voice input) is this site's only
        features = client.get("/").headers.get("permissions-policy", "")
        assert "camera=()" in features and "geolocation=()" in features and "microphone=(self)" in features


def test_successful_sign_ins_do_not_use_up_the_address_limit(tmp_path):
    # many people can share one address (a venue's Wi-Fi, a carrier's shared address): only failures count there
    from sqlmodel import Session, select

    from app.models import RateBucket
    runtime = Runtime(settings(tmp_path), background=False)
    with TestClient(create_app(runtime=runtime)) as client:
        assert client.post("/api/register", json=CUSTOMER, headers=ORIGIN).status_code == 201
        for _ in range(5):
            assert client.post("/api/login", json={"email": CUSTOMER["email"], "password": CUSTOMER["password"]}).status_code == 200
        with Session(runtime.engine) as session:
            assert not [b for b in session.exec(select(RateBucket)).all() if b.key.startswith("login-ip:")]
        assert client.post("/api/login", json={"email": CUSTOMER["email"], "password": "wrong password!"}).status_code == 401
        with Session(runtime.engine) as session:
            assert [b.count for b in session.exec(select(RateBucket)).all() if b.key.startswith("login-ip:")] == [1]

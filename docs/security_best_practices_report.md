# Security best-practices review

Method: the `security-best-practices` skill (`.claude/skills/security-best-practices`), using its references for the stack found in the repo: `python-fastapi-web-server-security.md` (backend: FastAPI 0.142.2, Starlette 1.7.0, Uvicorn 0.54.0, Pydantic 2.13.5, SQLModel), `javascript-general-web-frontend-security.md` and `javascript-typescript-react-web-frontend-security.md` (frontend: React 18 + Vite, HashRouter). Reviewed 22 October 2026 on `main`.

## Executive summary

No critical or high findings. The design already follows most of the specs: authentication is a router-level dependency on every app router, passwords and PINs use scrypt with a salt, session tokens are random and stored only as SHA-256 hashes, the session cookie is `HttpOnly` and `SameSite=Strict` (and `Secure` when the public URL is https), cookie-authenticated writes must carry a same-site `Origin`, request bodies are capped at 6 MB with a timeout and an in-flight limit, the generated-code sandbox runs as a separate isolated process with a hard timeout, uploads are type-checked, stored under random ids and served only to their owner with a path-containment check, the SQL is all ORM or parameterised, there is no `debug`, no `--reload`, no CORS, `proxy_headers=False`, ids are UUID4, and the frontend has no HTML-injection sinks, no `eval`, no third-party scripts and no service worker. Dependencies are current (Starlette is past every advisory the reference lists).

Two medium findings are worth fixing before the competition; the rest are low or informational.

**Status (22 October): all five findings are fixed**, each with a test in `backend/tests/test_security.py` (SBP-2 is frontend-only and was checked in the browser). With the policy in place, a browser walk through every page, the chat, the PIN dialog and dark mode recorded no CSP violations.

## Medium

### SBP-1 · No Content-Security-Policy restricting scripts (REACT-CSP-001, JS-CSP-001)
- Location: `deploy/Caddyfile:9` sets only `Content-Security-Policy "frame-ancestors 'none'"`; `backend/app/api/security.py:97-103` (`RequestBoundary.secured_send`) sets `nosniff` and `Referrer-Policy` but no CSP; `frontend/index.html:8-15` has one inline script (theme before first paint).
- Impact: if any script injection ever slipped in, nothing in the browser would stop it from running or from calling the API with the customer's session.
- Fix: send a CSP from the app for HTML responses (so local runs and Docker both get it): `default-src 'self'; script-src 'self' 'sha256-…'` (the hash of the one inline script), `style-src 'self' 'unsafe-inline'` (React style attributes), `img-src 'self' blob: data:` (receipt previews), `font-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
- False-positive note: none; verified that no CSP header is sent today.
- **Fixed:** `page_policy()` in `backend/app/api/security.py` builds the policy (the inline script's SHA-256 hash is read from the built `index.html`) and `RequestBoundary` sends it on every non-API response.

### SBP-2 · The operator token is kept in `localStorage` (REACT-AUTH-001, JS-STORAGE-001)
- Location: `frontend/src/api/client.ts:55-78` (`setAdminToken` → `localStorage.setItem('ba_admin_token', token)`).
- Impact: the server's `ADMIN_TOKEN` (full operator console) persists in the browser indefinitely and is readable by any script on the origin.
- Fix: keep it in `sessionStorage` (gone when the tab closes) with the in-memory fallback, and clear any old `localStorage` copy.
- **Fixed:** `frontend/src/api/client.ts` keeps the token in `sessionStorage` (this tab only) and removes any copy an older version left in `localStorage`.

## Low

### SBP-3 · Public POST routes don't check `Origin` (FASTAPI-CSRF-001, defence in depth)
- Location: `backend/app/api/accounts.py:164` `/api/register`, `:188` `/api/demo/start`, `:210` `/api/login`, `:225` `/api/logout`.
- Evidence: a request with `Origin: https://evil.example` gets 201 / 401 / 200 like a same-site one.
- Impact: today browsers can't exploit it (a cross-site JSON request needs a CORS preflight the server never grants; a `text/plain` form post gets 422), so this is login-CSRF hardening only.
- Fix: reject these routes when an `Origin` header is present and is not this site (scripts and the evaluation runner, which send a matching `Origin` or none, keep working).
- **Fixed:** `refuse_other_sites` in `backend/app/api/security.py` is a dependency of the four routes; a browser request from another site gets 403 `CROSS_SITE`.

### SBP-4 · API docs are public (FASTAPI-OPENAPI-001)
- Location: `backend/app/main.py:37-38` (`docs_url="/api/docs"`, `openapi_url="/api/openapi.json"`).
- Impact: information disclosure amplifier. Kept on purpose for the competition (judges and the "automated evaluation" section of the README drive the API); every route still requires a session or the operator token.
- Fix (when real customers are involved): disable or put behind the operator token; document the choice.
- **Fixed:** the docs are served only when `DEMO_TOOLS_ENABLED` is on, the switch already documented as off for real customers (`docs_switch` in `backend/app/main.py`). The docs' OAuth helper page now lives under `/api/docs/oauth2-redirect` too, so the switch covers it (second review).

### SBP-5 · Per-device rate limits key on a client-chosen header
- Location: `backend/app/api/accounts.py:137-139` (`device_limits` reads `X-Device-Id`).
- Impact: a script can rotate the header to get past the per-device limit; the per-email and global limits still apply, so brute force stays bounded.
- Fix: none needed for the demo; with real customers, key on the client IP from the trusted proxy as well.
- **Fixed:** `client_ip()` / `ip_limits()` in `backend/app/api/accounts.py` add a generous per-address limit: sign-in 60 failed attempts per 15 minutes (successful sign-ins don't count, so many people on one network can still sign in), sign-up 100 and demo 200 per hour (raised in the second review from 30 and 120, for a venue's shared Wi-Fi). The address comes from the proxy's `X-Forwarded-For` only when `BEHIND_PROXY` is set, which `deploy/docker-compose.yml` does; otherwise from the connection, so a client-supplied header is never trusted.

## Second review (22 October)

A second pass over the fixes above found three more things, all fixed:

- **Caddy replaced the app's policy.** `deploy/Caddyfile` still set `Content-Security-Policy "frame-ancestors 'none'"`. Because the same header block removes `Server` (a `-` entry), Caddy applies the block as the response is written, so that one line would have replaced the app's full policy behind the proxy. The line is gone; the app's policy already includes `frame-ancestors 'none'`, and `X-Frame-Options DENY` stays. Not testable without running Caddy locally; checked by reading the config.
- **The per-address sign-in limit counted successful sign-ins.** At a venue where everyone shares one address, 60 sign-ins in 15 minutes would have locked everyone out. Now only failed attempts count there (`test_successful_sign_ins_do_not_use_up_the_address_limit`), and the sign-up and demo limits per address are higher (100 and 200 per hour).
- **The docs' OAuth helper page was outside the switch.** FastAPI serves it at `/docs/oauth2-redirect` by default; it now sits under `/api/docs/` and returns 404 with demo tools off (`test_api_docs_follow_the_demo_tools_switch`).

## Informational

- Request models ignore unknown fields instead of rejecting them (`extra` not set to `forbid`, e.g. `backend/app/api/agent.py:23` `ChatIn`). No mass-assignment risk because every handler reads named fields only; the planner's own plan schema is strict.
- `deploy/Caddyfile:10` sends `Strict-Transport-Security "max-age=86400"`: short, so a rollback stays possible.
- Host restriction is in the app too (`host_boundary` in `backend/app/main.py` accepts only localhost and the public host); TLS comes from Caddy. Verify both on the real host.

## Third review (24 October)

Scope: everything since the second review (the WeChat assistant channel `backend/app/api/wechat.py`, `backend/app/channels/wechat.py`, `frontend/src/pages/Wechat.tsx`, `Confirm.tsx`; the evening click-through fixes), plus dependency advisories and response headers on a running server.

Checked and fine: every route with an id in its path checks that the record belongs to the caller (plans through `load()`, conversations, uploads, demo transfers; operator routes are staff-only); the frontend has no HTML-injection sinks, `eval`, `window.open` or data-driven links; API responses carry `Cache-Control: no-store`; the session cookie is `HttpOnly` and `SameSite=Strict`. Against a running server: a link or unlink from another site is refused (403); the app's cookie alone can't use the chat channel (401); the chat's credential can neither approve a plan nor read balances (401); a forged credential is refused (401); a message over 1,000 characters is rejected (422).

### SBP-6 · Pillow 12.3.0 had 37 published advisories (FASTAPI-SUPPLY-001) · Medium
- Location: `backend/pyproject.toml` (`pillow>=12.3.0`), used by `backend/app/pipeline/ingest.py:48` to read uploaded receipt photos.
- Impact: most advisories are in readers uploads never reach (TIFF, GIF, EPS, FlashPix, XBM: the magic-byte check admits only PDF, PNG and JPEG), but two reach the PNG path (a large eXIf chunk costs quadratic CPU; APNG frames allocate before the bomb check). Both are denial of service, bounded by the isolated worker's 12-second wall clock.
- **Fixed:** Pillow 13.0.0; `Image.open(..., formats=("PNG", "JPEG"))`, so Pillow's other readers are never tried even if the byte check were bypassed (`test_only_png_and_jpeg_decoders_ever_see_an_upload`). Also updated: certifi 2026.10.23 (an untrusted root removed) and opentelemetry-api 1.45.1 (through FastAPI). `pip-audit` on the locked packages now reports none.

### SBP-7 · The simulated WeChat credential was kept in `localStorage` (REACT-AUTH-001) · Low
- Location: `frontend/src/pages/Wechat.tsx` (`keep(tokenKey, linked.token, 'local')`).
- Impact: the chat's credential (it can ask about the account, never approve) outlived the tab.
- **Fixed:** kept in `sessionStorage`, like the operator token (SBP-2); an older copy in `localStorage` is removed. Known risk 15 in the security self-assessment says so.

### SBP-8 · No `Permissions-Policy` (FASTAPI-HEADERS-001) · Low
- **Fixed:** pages now send `camera=(), geolocation=(), payment=(), usb=(), microphone=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)` (voice input and passkeys keep working). Tested in `test_pages_carry_a_content_security_policy`.

### SBP-9 · Build-tool advisories in the frontend (REACT-SUPPLY-001) · Informational, not fixed
- `npm audit`: Vite 5.4.21 (high; and esbuild through it), tailwindcss 3 with postcss-nested and postcss-selector-parser (moderate), react-router 6 (moderate; kept on 6.x by the team's decision of 22 October).
- Vite's and esbuild's advisories concern the development server (`npm run dev`), which the deployed app never runs: the backend serves the built files. Tailwind's and PostCSS's are CPU cost while building. Each fix is a major upgrade (Vite 8, Tailwind 4). Left for the team to decide; until then, don't expose `npm run dev` on a shared network.

## Fourth review (27 October)

Method: the procedures of eight skills from the Anthropic Cybersecurity Skills library (github.com/mukul975/Anthropic-Cybersecurity-Skills, Apache-2.0; community-made, not Anthropic's): securing agentic AI tool invocation, OWASP API Top 10 testing, LLM guardrails, indirect prompt injection, system prompt leakage, race conditions, XSS, and DevSecOps scanning. Applied to this app against a local server; nothing from the library is in the repository.

Checked and fine: another customer's plans, conversations and audit trail on 10 id routes (404); every account route without a session (401); session cookie flags; mass assignment on sign-up (ignored); staff routes with a customer session (403); no CORS grant; malformed JSON (422, no internals); 7 MB body (413); page size (422); sign-in brute force (429 at the 11th try); races (two approvals at the same instant, one plan approved five times at once: money moved once, the daily limit held); 16 sandbox escapes beyond the tests (all refused or stopped); 16 new attack phrasings with Qwen (none ran without approval, all flagged); a secret scan of every commit (none); Bandit 1.9.4 (4 medium and 5 low, each a false positive or intended: fixed table names, a fixed health-check URL, the container's own bind, the sandbox's checked `exec`); `pip-audit` of the 45 locked packages (none); `npm audit --omit=dev` (the 2 react-router advisories of SBP-9).

### SBP-10 · Chat messages had no per-customer limit (OWASP API4) · Medium
- 80 messages in a row were all answered. Each can be a paid model call and always writes to the audit log.
- **Fixed:** 30 a minute and 400 an hour per customer (`backend/app/api/agent.py`), tested in `test_sign_in_attempts_and_chat_are_limited`.

### SBP-11 · SMS codes could be requested without limit (OWASP API6, SMS pumping) · Medium
- 25 code requests for one plan were all sent.
- **Fixed:** 5 per plan and 10 per customer in ten minutes, shared with the unlock code (`agent.py`, `bank.py`), tested in `test_large_transfer_with_pin_and_sms`.

### SBP-12 · A locked plan still asked for the PIN and a code · Low
- After three wrong PINs the plan did fail with “a safety lock is on” and no money moved, but only after the customer had typed the PIN and a fresh code.
- **Fixed:** the code request answers 423 with the lock's message, before any code is sent (same test).

### SBP-13 · The model's clarifying question wasn't checked for phishing (OWASP LLM risks: improper output handling) · Low
- The only model-written text a customer sees is its question. Hidden text in a receipt (indirect prompt injection, ATLAS AML.T0051.001) could try to make it ask for a code or send a link.
- **Fixed:** `validate()` rejects a question that asks for a PIN, code or password, or contains a link (`ASK_UNSAFE`, `backend/app/agent/screening.py`): it is recorded, counts towards the safety lock and the offline planner answers instead. Caught 12 of 12 phishing-style questions with no false alarm on 12 normal ones; tested in `test_question_may_not_state_numbers_ask_for_a_secret_or_send_a_link`.

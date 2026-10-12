"""Process-wide services, created once at startup."""

import asyncio
import fcntl
import logging
import os
import secrets
import time

from sqlmodel import Session, select

from app.agent import scheduler
from app.agent.planner import Planner
from app.db import make_engine
from app.llm import ModelGateway
from app.model_budget import ModelCallBudget
from app.models import UserAccount, UserSession

log = logging.getLogger(__name__)


class Runtime:
    def __init__(self, settings, *, gateway: ModelGateway | None = None, background: bool = True):
        self.settings = settings
        self.engine = make_engine(settings.data_dir / "bank.db")
        # Rate-limit identities are hashed with this when no salt is configured (development only).
        self.fallback_salt = secrets.token_hex(16)
        if gateway is None:
            gateway = ModelGateway.openai_compatible(
                settings.ai_base_url, settings.ai_api_key.get_secret_value(),
                enabled=settings.llm_enabled and bool(settings.ai_base_url and settings.ai_model),
                hourly_cap=settings.llm_hourly_call_cap, max_tokens=settings.llm_max_output_tokens,
                timeout=settings.llm_timeout_seconds, budget=ModelCallBudget(self.engine, settings.llm_hourly_call_cap))
        self.planner = Planner(gateway, settings.ai_model)
        self.background = background
        self.tasks: list[asyncio.Task] = []
        self.lease = None

    async def start(self):
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.settings.data_dir / ".runtime.lock", os.O_CREAT | os.O_RDWR, 0o600)
        self.lease = os.fdopen(descriptor, "w")
        try:
            fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lease.close()
            self.lease = None
            raise RuntimeError("Only one backend process may own this data directory") from None
        if self.background:
            self.tasks.append(asyncio.create_task(self.scheduler_loop()))

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        if self.lease:
            self.lease.close()

    def active_users(self, session: Session) -> list[UserAccount]:
        ids = set(session.exec(select(UserSession.user_id).where(UserSession.expires_at > int(time.time()))).all())
        return [u for u in (session.get(UserAccount, i) for i in ids) if u]

    async def scheduler_loop(self):
        while True:
            await asyncio.sleep(self.settings.scheduler_interval_seconds)
            try:
                await asyncio.to_thread(self.tick_all)
            except Exception:
                log.exception("scheduler tick failed")

    def tick_all(self):
        with Session(self.engine) as session:
            for user in self.active_users(session):
                try:
                    scheduler.tick(session, user)
                except Exception:
                    session.rollback()
                    log.exception("scheduler tick failed for one customer")

    def health(self) -> dict:
        return {"ok": True, "planner": "ai" if self.planner.online else "offline",
                "demo_tools": self.settings.demo_tools_enabled}

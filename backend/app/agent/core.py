"""The action catalogue's building blocks.

An action is the only way the agent can touch the bank. Each one declares its argument schema
(extra fields are rejected), how its words map to the customer's records, its permission rule,
what it does, how its result is described in both languages, and how to undo it if that is safe.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict
from sqlmodel import Session

from app.clock import CST
from app.models import Plan, UserAccount

TIERS = {"green": 0, "yellow": 1, "red": 2}


def tier_of(rule: str) -> str:
    return {"G": "green", "Y": "yellow", "R": "red"}[rule[0]]


def higher(a: str, b: str) -> str:
    return a if TIERS[a] >= TIERS[b] else b


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)


@dataclass
class Ctx:
    session: Session
    user: UserAccount
    now: datetime
    lang: str = "zh"
    plan: Plan | None = None
    services: object | None = None

    @property
    def today(self) -> date:
        return self.now.astimezone(CST).date()

    def t(self, zh: str, en: str) -> str:
        return zh if self.lang == "zh" else en


class Ask(Exception):
    """The request matches several records (or misses a detail): ask, with choices built by code."""

    def __init__(self, field_name: str, zh: str, en: str, options: list[dict] | None = None):
        super().__init__(en)
        self.field, self.zh, self.en, self.options = field_name, zh, en, options or []


class Refuse(Exception):
    """The step cannot be done as asked (not found, not allowed, invalid)."""

    def __init__(self, code: str, zh: str, en: str):
        super().__init__(en)
        self.code, self.zh, self.en = code, zh, en


@dataclass
class Action:
    name: str
    args: type[Args]
    help: str
    resolve: Callable[[Ctx, Args], dict]
    run: Callable[[Ctx, dict], dict]
    describe: Callable[[Ctx, dict], str]
    reply: Callable[[Ctx, dict, dict], str]
    rule: str | Callable[[Ctx, dict], str] = "G_QUERY"
    payment: Callable[[dict], int] | None = None
    compensate: Callable[[Ctx, dict, dict], dict] | None = None
    card: Callable[[Ctx, dict, dict], dict | None] | None = None
    schedulable: bool = False
    examples: list[str] = field(default_factory=list)

    @property
    def query(self) -> bool:
        return self.rule == "G_QUERY"

    def rule_for(self, ctx: Ctx, resolved: dict) -> str:
        return self.rule(ctx, resolved) if callable(self.rule) else self.rule


REGISTRY: dict[str, Action] = {}


def register(action: Action) -> Action:
    if action.name in REGISTRY:
        raise ValueError(f"duplicate action {action.name}")
    REGISTRY[action.name] = action
    return action

"""Private persistence models. Public responses must use explicit projections.

Amounts are integer fen. Bank-side times (transactions, schedules, orders) follow the customer's
demo clock in UTC+8; audit times are real UTC.
"""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def new_id() -> str:
    return str(uuid4())


def json_list():
    return Field(default_factory=list, sa_column=Column(JSON, nullable=False))


def json_dict():
    return Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


def json_optional():
    return Field(default=None, sa_column=Column(JSON))


# --- accounts and service plumbing -------------------------------------------------------------


class UserAccount(SQLModel, table=True):
    """A bank customer of the simulated bank. Credentials are stored only as scrypt hashes."""

    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    name: str
    password_hash: str
    pin_hash: str | None = None
    phone: str = ""
    operator: bool = False
    demo: bool | None = None  # a one-click demo account: no email, PIN shown on screen
    created_at: str = Field(default_factory=now_iso)


class UserSession(SQLModel, table=True):
    """Only the SHA-256 of the session cookie is stored."""

    token_hash: str = Field(primary_key=True)
    user_id: str = Field(index=True)
    expires_at: int = Field(index=True)
    created_at: str = Field(default_factory=now_iso)


class RateBucket(SQLModel, table=True):
    key: str = Field(primary_key=True)
    count: int = 0
    expires_at: int = Field(index=True)


class ModelCallReservation(SQLModel, table=True):
    id: str = Field(primary_key=True)
    reserved_at: float = Field(index=True)


class DemoClock(SQLModel, table=True):
    user_id: str = Field(primary_key=True)
    offset_seconds: int = 0


# --- the simulated bank ------------------------------------------------------------------------


class BankAccount(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    kind: str  # checking | savings | reserve
    name: str
    name_en: str
    number: str
    balance_fen: int = 0
    purpose: str | None = None
    release_on: str | None = None  # reserves: the date the money returns to checking
    status: str = "open"  # open | closed
    created_at: str


class Txn(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    account_id: str = Field(index=True)
    at: str = Field(index=True)
    amount_fen: int  # positive = money in, negative = money out
    kind: str  # card | transfer_out | transfer_in | salary | direct_debit | order | internal | wealth | refund
    counterparty: str
    counterparty_account: str | None = None
    category: str
    channel: str = "mobile"  # pos | online | mobile | atm | overseas | auto
    card_id: str | None = None
    memo: str | None = None  # outside text: never shown to the model
    city: str | None = None
    country: str = "CN"
    status: str = "posted"  # posted | reversed
    plan_id: str | None = None
    payee_id: str | None = None


class Payee(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    name: str
    name_en: str = ""
    aliases: list = json_list()
    phone: str
    bank: str
    account_no: str
    relationship: str | None = None
    birthday: str | None = None  # MM-DD
    note: str | None = None
    created_at: str
    last_paid_at: str | None = None


class Card(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    kind: str  # debit | virtual
    name: str
    name_en: str
    last4: str
    account_id: str
    status: str = "active"  # active | frozen | lost | pending
    daily_limit_fen: int
    online_enabled: bool = True
    overseas_enabled: bool = False
    atm_enabled: bool = True
    contactless_enabled: bool = True
    expires: str
    created_at: str


class Subscription(SQLModel, table=True):
    """A recurring charge found in the customer's transactions (see bank.analysis.detect_recurring)."""

    __table_args__ = (UniqueConstraint("user_id", "key"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    key: str  # normalized merchant + amount
    merchant: str
    category: str
    amount_fen: int
    cycle: str  # monthly | yearly
    first_seen: str
    last_charged: str
    next_charge_on: str
    charges: int
    status: str = "active"  # active | cancelled | ended (no longer charging)
    remind_days_before: int | None = None
    cancelled_at: str | None = None
    card_id: str | None = None


class ScheduledTransfer(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    payee_id: str
    amount_fen: int
    memo: str | None = None
    run_at: str = Field(index=True)
    repeat: str = "none"  # none | monthly
    status: str = "scheduled"  # scheduled | waiting_approval | done | cancelled | failed
    plan_id: str | None = None
    step_id: str | None = None
    created_at: str
    last_run_at: str | None = None
    detail: str | None = None


class Transfer(SQLModel, table=True):
    """A transfer as the bank processes it (bank/transfers.py): accepted, then clearing, then arrived,
    returned by the payee's bank, or cancelled by the customer while a delayed transfer waits."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    payee_id: str
    payee_name: str
    payee_name_en: str
    bank: str
    account_tail: str
    source_id: str
    amount_fen: int
    memo: str | None = None
    route: str  # internal (same bank) | ibps (超级网银, interbank real time)
    arrival: str = "instant"  # instant | standard (2 hours) | next_day
    arrival_reason: str | None = None  # the risk signal that made the rules choose a later arrival
    status: str = "accepted"  # accepted | clearing | arrived | returned | cancelled
    reason: str | None = None  # why the payee's bank returned it
    debit_txn_id: str | None = None
    created_at: str = Field(index=True)
    arrive_at: str
    finished_at: str | None = None
    events: list = json_list()
    plan_id: str | None = None
    scheduled_id: str | None = None


class PayeeMessage(SQLModel, table=True):
    """What the payee's phone receives from their bank: the other half of the two-phone demo."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)  # the sender, who owns this simulation
    payee_id: str
    at: str
    text: str
    text_en: str


class Collection(SQLModel, table=True):
    """A split-bill (AA) collection request sent to payees. No money leaves the account."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    title: str
    total_fen: int
    participants: list = json_list()  # [{payee_id, name, share_fen, status}]
    status: str = "open"  # open | closed | cancelled
    created_at: str
    plan_id: str | None = None


class WealthProduct(SQLModel, table=True):
    code: str = Field(primary_key=True)
    name: str
    name_en: str
    kind: str  # money_market | bond | mixed | equity | qdii
    risk_level: int  # 1 (R1, lowest) .. 5 (R5)
    annual_yield_bp: int  # recent annualized yield, basis points (simulated)
    return_1y_bp: int
    max_drawdown_bp: int
    min_fen: int
    redeem_days: int
    fee_bp: int
    description: str
    description_en: str


class Holding(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "product_code"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    product_code: str
    principal_fen: int
    value_fen: int
    since: str
    updated_at: str


class RiskProfile(SQLModel, table=True):
    user_id: str = Field(primary_key=True)
    level: int  # 1 (C1, conservative) .. 5 (C5, aggressive)
    assessed_at: str
    answers: list = json_list()


class Order(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    merchant: str
    item: str
    item_name: str
    amount_fen: int
    deliver_on: str
    recipient: str | None = None
    status: str = "scheduled"  # scheduled | waiting_approval | paid | cancelled | failed
    pay_from: str
    pay_at: str
    plan_id: str | None = None
    step_id: str | None = None
    created_at: str
    paid_at: str | None = None


class Upload(SQLModel, table=True):
    """A receipt photo or PDF. Only the code-checked reading is kept with it, never raw model text."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    created_at: str = Field(default_factory=now_iso)
    kind: str  # pdf | image
    preview_path: str | None = None
    read_by: str  # model | rules
    reading: dict = json_dict()
    flags: list = json_list()


# --- the agent ---------------------------------------------------------------------------------


class Conversation(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    created_at: str = Field(default_factory=now_iso)
    escalated: bool = False
    escalated_reason: str | None = None


class Message(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    conversation_id: str = Field(index=True)
    user_id: str = Field(index=True)
    at: str = Field(default_factory=now_iso, index=True)
    role: str  # user | assistant | operator | system
    text: str
    lang: str = "zh"
    plan_id: str | None = None
    cards: list = json_list()
    summary: str | None = None  # code-written context for the planner


class Plan(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    conversation_id: str = Field(index=True)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    status: str = Field(default="clarifying", index=True)
    request: str
    lang: str = "zh"
    source: str = "offline"  # ai | offline | operator | suggestion
    model: str | None = None
    steps: list = json_list()
    ask: dict | None = json_optional()
    flags: list = json_list()
    approval_hash: str | None = None
    tier: str = "green"
    approved_at: str | None = None
    verified_at: str | None = None


class Challenge(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    plan_id: str | None = None
    purpose: str  # plan | unlock | passkey_register
    kind: str  # sms | passkey
    code_hash: str | None = None
    payload: dict = json_dict()
    expires_at: int
    attempts: int = 0
    used: bool = False
    created_at: str = Field(default_factory=now_iso)


class Passkey(SQLModel, table=True):
    id: str = Field(primary_key=True)  # base64url credential ID
    user_id: str = Field(index=True)
    public_key: str
    sign_count: int = 0
    label: str = ""
    created_at: str = Field(default_factory=now_iso)


class SmsMessage(SQLModel, table=True):
    """The simulated phone. Real SMS delivery is out of scope for the demo bank."""

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    at: str = Field(default_factory=now_iso)
    text: str
    text_en: str


class Notification(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "key"),)
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    key: str
    at: str
    kind: str  # renewal | birthday | anomaly | schedule | lock | info
    title: str
    title_en: str
    body: str
    body_en: str
    suggestion: str | None = None
    suggestion_en: str | None = None
    read: bool = False


class SafetyLock(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(index=True)
    scope: str  # red | agent | payments
    reason: str
    at: str = Field(default_factory=now_iso)
    expires_at: str | None = None
    cleared_at: str | None = None
    cleared_by: str | None = None


class AuditEntry(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("user_id", "seq"),)
    id: int | None = Field(default=None, primary_key=True)
    user_id: str = Field(index=True)
    seq: int
    kind: str = Field(index=True)
    plan_id: str | None = Field(default=None, index=True)
    data: dict = json_dict()
    at: str = Field(default_factory=now_iso, index=True)
    prev_hash: str
    hash: str

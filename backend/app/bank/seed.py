"""The demo customer: realistic, deterministic, and dated relative to the customer's clock.

Every new account gets the same persona, so demos and tests are reproducible. History starts on
1 January of the previous year, so a full-year report always has a complete year to work with.
"""

import random
from datetime import date, datetime, time, timedelta

from sqlmodel import Session, delete, select

from app import clock
from app.bank.categories import categorize
from app.clock import CST
from app.models import (
    BankAccount,
    Card,
    Collection,
    Conversation,
    DemoClock,
    Holding,
    Message,
    Notification,
    Order,
    Payee,
    PayeeMessage,
    Plan,
    RiskProfile,
    SafetyLock,
    ScheduledTransfer,
    SmsMessage,
    Subscription,
    Transfer,
    Txn,
    UserAccount,
    WealthProduct,
)

SEED = 20261102
CITY = "武汉"

PRODUCTS = [
    dict(code="WX0001", name="稳享货币A", name_en="Steady Money Market A", kind="money_market",
         risk_level=1, annual_yield_bp=162, return_1y_bp=165, max_drawdown_bp=0, min_fen=100,
         redeem_days=0, fee_bp=0,
         description="货币基金，随存随取，适合日常闲钱。",
         description_en="Money-market fund. Redeem any day; suits everyday spare cash."),
    dict(code="WX0102", name="安盈短债", name_en="Anying Short-term Bond", kind="bond",
         risk_level=2, annual_yield_bp=245, return_1y_bp=280, max_drawdown_bp=35, min_fen=10_000,
         redeem_days=1, fee_bp=0,
         description="短期债券基金，波动小，T+1 到账。",
         description_en="Short-term bond fund. Low volatility; money arrives T+1."),
    dict(code="WX0205", name="均衡配置混合", name_en="Balanced Allocation Mixed", kind="mixed",
         risk_level=3, annual_yield_bp=0, return_1y_bp=560, max_drawdown_bp=820, min_fen=100_000,
         redeem_days=2, fee_bp=60,
         description="股债均衡配置，适合能接受中等波动的客户。",
         description_en="Stocks and bonds in balance, for customers who accept moderate swings."),
    dict(code="WX0310", name="科技成长股票", name_en="Tech Growth Equity", kind="equity",
         risk_level=4, annual_yield_bp=0, return_1y_bp=1240, max_drawdown_bp=2450, min_fen=100_000,
         redeem_days=3, fee_bp=150,
         description="主要投资科技行业股票，波动较大。",
         description_en="Mostly technology-sector stocks. Large swings."),
    dict(code="WX0420", name="全球精选QDII", name_en="Global Select QDII", kind="qdii",
         risk_level=5, annual_yield_bp=0, return_1y_bp=980, max_drawdown_bp=2800, min_fen=100_000,
         redeem_days=7, fee_bp=150,
         description="投资海外市场，含汇率风险，赎回 T+7。",
         description_en="Overseas markets, with currency risk. Redemption takes T+7."),
]

PAYEES = [
    dict(key="mother", name="王秀英", name_en="Wang Xiuying", relationship="mother",
         aliases=["妈妈", "妈", "老妈", "母亲", "mom", "mum", "mother", "my mom"],
         phone="13971230418", bank="中国工商银行", account_no="6222021203457801",
         birthday="03-08", note="家人"),
    dict(key="father", name="李建国", name_en="Li Jianguo", relationship="father",
         aliases=["爸爸", "爸", "老爸", "父亲", "dad", "father", "my dad"],
         phone="13971230866", bank="中国工商银行", account_no="6222021203452266",
         birthday="07-21", note="家人"),
    dict(key="spouse", name="陈静", name_en="Chen Jing", relationship="spouse",
         aliases=["老婆", "媳妇", "妻子", "爱人", "wife", "my wife", "spouse"],
         phone="13886051123", bank="演示银行", account_no="6225880145671123",
         birthday=None, note="家人"),
    dict(key="zhangwei", name="张伟", name_en="Zhang Wei", relationship="friend",
         aliases=["小张", "伟哥", "xiao zhang"], phone="13912345678", bank="中国建设银行",
         account_no="6217003310045678", note="大学同学"),
    dict(key="zhangwei2", name="张薇", name_en="Zhang Wei", relationship="colleague",
         aliases=["小张", "xiao zhang"], phone="13698765432", bank="交通银行",
         account_no="6222600512349876", note="同事，财务部"),
    dict(key="roommate", name="刘洋", name_en="Liu Yang", relationship="roommate",
         aliases=["室友", "roommate"], phone="15527301190", bank="演示银行",
         account_no="6217856100023190", note="室友，水电网费AA"),
    dict(key="landlord", name="赵建华", name_en="Zhao Jianhua", relationship="landlord",
         aliases=["房东", "landlord"], phone="13507149922", bank="中国农业银行",
         account_no="6228480402567722", note="房租"),
    dict(key="wangfang", name="王芳", name_en="Wang Fang", relationship="friend",
         aliases=["芳芳"], phone="18672045531", bank="招商银行",
         account_no="6225880178905531", note="羽毛球球友"),
    dict(key="sunlei", name="孙磊", name_en="Sun Lei", relationship="friend",
         aliases=["磊子"], phone="13317182240", bank="浦发银行",
         account_no="6217921200182240", note="高中同学"),
    dict(key="newseller", name="周凯", name_en="Zhou Kai", relationship=None,
         aliases=[], phone="17085523307", bank="某村镇银行",
         account_no="6230580000673307", note="二手相机卖家，今天新加"),
]


def at(day: date, hour: int, minute: int = 0) -> str:
    return clock.iso(datetime.combine(day, time(hour, minute), CST))


def reset_customer(session: Session, user_id: str) -> None:
    """Remove the customer's bank and conversation data (the audit log is kept)."""
    for table in (Txn, Payee, Card, BankAccount, Subscription, ScheduledTransfer, Collection,
                  Holding, RiskProfile, Order, Plan, Message, Conversation, SmsMessage,
                  Notification, SafetyLock, DemoClock, Transfer, PayeeMessage):
        session.exec(delete(table).where(table.user_id == user_id))


def ensure_products(session: Session) -> None:
    for product in PRODUCTS:
        if session.get(WealthProduct, product["code"]) is None:
            session.add(WealthProduct(**product))


def seed_customer(session: Session, user: UserAccount, now: datetime) -> None:
    rng = random.Random(SEED)
    today = now.astimezone(CST).date()
    start = date(today.year - 1, 1, 1)
    opened = at(start - timedelta(days=420), 10)
    ensure_products(session)
    if not user.phone:
        user.phone = "13900000000"
        session.add(user)

    checking = BankAccount(user_id=user.id, kind="checking", name="活期账户", name_en="Current account",
                           number="6217 **** **** 0428", balance_fen=2_864_035, created_at=opened)
    savings = BankAccount(user_id=user.id, kind="savings", name="储蓄账户", name_en="Savings account",
                          number="6217 **** **** 3392", balance_fen=6_000_000, created_at=opened)
    debit = Card(user_id=user.id, kind="debit", name="借记卡", name_en="Debit card", last4="0428",
                 account_id=checking.id, daily_limit_fen=2_000_000, expires="09/30", created_at=opened)
    virtual = Card(user_id=user.id, kind="virtual", name="网购虚拟卡", name_en="Online shopping card",
                   last4="8831", account_id=checking.id, daily_limit_fen=300_000, atm_enabled=False,
                   contactless_enabled=False, overseas_enabled=True,  # for overseas shopping sites; the debit card's are off
                   expires="04/28", created_at=at(start + timedelta(days=40), 15))
    session.add_all([checking, savings, debit, virtual])

    payees = {}
    for spec in PAYEES:
        spec = dict(spec)
        key = spec.pop("key")
        if key == "spouse":
            spec["birthday"] = (today + timedelta(days=35)).strftime("%m-%d")
        created = at(today, max(0, now.hour - 3)) if key == "newseller" else at(start - timedelta(days=300), 11)
        payee = Payee(user_id=user.id, created_at=created, **spec)
        payees[key] = payee
        session.add(payee)

    txns: list[Txn] = []

    def add(when: str, yuan: float, kind: str, counterparty: str, *, channel="mobile", card=None,
            payee=None, memo=None, city=CITY, country="CN", status="posted"):
        fen = round(yuan * 100)
        txns.append(Txn(
            user_id=user.id, account_id=checking.id, at=when, amount_fen=fen, kind=kind,
            counterparty=counterparty if payee is None else payee.name,
            counterparty_account=None if payee is None else payee.account_no[-4:],
            category=categorize(counterparty, kind, relationship=payee.relationship if payee else None),
            channel=channel, card_id=card.id if card else None, memo=memo, city=city,
            country=country, status=status, payee_id=payee.id if payee else None,
        ))

    def price(low: float, high: float) -> float:
        return round(rng.uniform(low, high), 1) if high < 60 else round(rng.uniform(low, high))

    months_back = (today.year - start.year) * 12 + today.month - start.month
    day = start
    while day < today:
        index = (day.year - start.year) * 12 + day.month - start.month
        weekend = day.weekday() >= 5
        winter = day.month in (12, 1, 2)
        summer = day.month in (6, 7, 8)
        # fixed monthly items
        if day.day == 1:
            add(at(day, 8, 5), -3200, "transfer_out", "", payee=payees["landlord"],
                memo=f"{day.month}月房租")
        if day.day == 3:
            add(at(day, 6, 12), -199, "card", "乐动力健身(光谷店)", channel="auto", card=debit)
        if day.day == 5:
            add(at(day, 0, 31), -30, "card", "腾讯视频VIP会员", channel="auto", card=virtual)
        if day.day == 8:
            add(at(day, 2, 10), -58, "direct_debit", "中国移动 话费套餐", channel="auto")
        if day.day == 10:
            add(at(day, 9, 30), 16800, "salary", "武汉光谷云图科技有限公司", channel="auto", memo="工资")
        if day.day == 12:
            add(at(day, 0, 44), -25, "card", "爱奇艺VIP会员", channel="auto", card=virtual)
            add(at(day, 3, 0), -99, "direct_debit", "中国电信 宽带", channel="auto")
        if day.day == 15:
            add(at(day, 20, 30), -800, "transfer_out", "", payee=payees["mother"], memo="生活费")
        if day.day == 18:
            add(at(day, 1, 5), -15, "card", "网易云音乐 黑胶VIP", channel="auto", card=virtual)
        if day.day == 20:
            add(at(day, 4, 15), -price(110, 180) if not (winter or summer) else -price(220, 330),
                "direct_debit", "国家电网 电费", channel="auto")
            if index >= months_back - 7:
                add(at(day, 1, 20), -15, "card", "QQ音乐 绿钻", channel="auto", card=virtual)
        if day.day == 21:
            add(at(day, 4, 30), -price(35, 62), "direct_debit", "武汉水务 水费", channel="auto")
        if day.day == 22:
            add(at(day, 0, 50), -30, "card", "百度网盘SVIP", channel="auto", card=debit)
        if day.day == 25 and (winter or day.month in (3, 11)):
            add(at(day, 4, 45), -price(60, 140), "direct_debit", "武汉燃气 燃气费", channel="auto")
        if day.day == 9 and index >= months_back - 2:
            add(at(day, 0, 20), -29.9, "card", "WPS超级会员 自动续费", channel="auto", card=virtual)
        if day.day == 16 and index <= months_back - 6:
            add(at(day, 0, 40), -25, "card", "Keep会员", channel="auto", card=virtual)
        if day.month == 3 and day.day == 14:
            add(at(day, 0, 5), -198, "card", "京东PLUS会员 年费", channel="auto", card=virtual)
        if day.day == 28:
            add(at(day, 21, 10), price(80, 180), "transfer_in", "", payee=payees["roommate"],
                memo="水电网费AA")
        if day.day in (2, 17):
            add(at(day, 8, 40), -100, "card", "武汉通充值", channel="mobile", card=debit)

        # everyday spending
        if not weekend and rng.random() < 0.5:
            add(at(day, 8, rng.randint(5, 55)), -price(9.9, 19.9), "card",
                rng.choice(["瑞幸咖啡(光谷软件园店)", "瑞幸咖啡(关山大道店)"]), channel="pos", card=debit)
        if rng.random() < (0.35 if weekend else 0.6):
            add(at(day, 12, rng.randint(0, 50)), -price(22, 45), "card",
                rng.choice(["美团外卖", "饿了么"]), channel="online", card=virtual)
        if rng.random() < 0.3:
            add(at(day, 19, rng.randint(0, 59)), -price(25, 68), "card",
                rng.choice(["美团外卖", "饿了么", "喜茶(光谷世界城店)", "肯德基(鲁巷店)"]),
                channel="online" if rng.random() < 0.6 else "pos", card=virtual)
        if weekend and rng.random() < 0.12:
            when, amount = at(day, 18, rng.randint(10, 50)), -price(180, 420)  # drawn either way: same seed after
            if day < today - timedelta(days=2):  # the seeded dinner below stays the latest visit, for "昨晚海底捞…AA"
                add(when, amount, "card", "海底捞火锅(光谷店)", channel="pos", card=debit)
        if weekend and rng.random() < 0.15:
            add(at(day, 20, rng.randint(0, 30)), -price(39, 90), "card", "猫眼电影", channel="online",
                card=virtual)
        if weekend and rng.random() < 0.06:
            add(at(day, 20, rng.randint(0, 30)), -price(25, 45), "card", "星巴克(楚河汉街店)",
                channel="pos", card=debit)
        if rng.random() < (0.35 if weekend else 0.12):
            add(at(day, rng.randint(17, 21), rng.randint(0, 59)), -price(60, 220), "card",
                rng.choice(["盒马鲜生(光谷店)", "永辉超市(鲁巷店)", "叮咚买菜"]), channel="online", card=virtual)
        if rng.random() < 0.22:
            add(at(day, rng.randint(7, 22), rng.randint(0, 59)), -price(12, 58), "card", "滴滴出行",
                channel="online", card=virtual)
        if rng.random() < 0.13:
            add(at(day, rng.randint(10, 23), rng.randint(0, 59)), -price(29, 480), "card",
                rng.choice(["淘宝 天猫", "淘宝", "拼多多"]), channel="online", card=virtual)
        if rng.random() < 0.04:
            add(at(day, rng.randint(10, 23), rng.randint(0, 59)), -price(80, 1200), "card",
                "京东商城", channel="online", card=virtual)
        if rng.random() < 0.02:
            add(at(day, rng.randint(9, 20), rng.randint(0, 59)), -price(25, 160), "card",
                "老百姓大药房", channel="pos", card=debit)

        # seasonal and one-off items
        if day.month == 1 and day.day == 18:
            add(at(day, 9, 12), -price(380, 460), "card", "12306 铁路购票", channel="online", card=debit)
        if day.month == 9 and day.day == 26:
            add(at(day, 21, 40), -price(1100, 1500), "card", "携程旅行 酒店", channel="online", card=debit)
            add(at(day, 21, 52), -price(420, 560), "card", "12306 铁路购票", channel="online", card=debit)
        if day.month == 11 and day.day == 11:
            add(at(day, 0, 3), -3299, "card", "京东商城 Apple iPad", channel="online", card=virtual)
            add(at(day, 0, 20), -price(200, 400), "card", "淘宝 天猫 双11", channel="online", card=virtual)
        if day.month in (4, 10) and day.day == 6:
            add(at(day, 15, 20), -price(299, 699), "card", "优衣库(武汉天地店)", channel="pos", card=debit)
        if day == today - timedelta(days=40):
            for extra in range(8):  # last month's dining spike
                add(at(day + timedelta(days=extra * 3), 19, 30), -price(80, 160), "card",
                    "海底捞火锅(光谷店)" if extra % 2 else "美团外卖", channel="online", card=virtual)
        day += timedelta(days=1)

    # seeded anomalies, dated relative to today
    duplicate = today - timedelta(days=6)
    add(at(duplicate, 19, 42), -58, "card", "美团外卖", channel="online", card=virtual)
    add(at(duplicate, 19, 43), -58, "card", "美团外卖", channel="online", card=virtual)
    add(at(today - timedelta(days=3), 3, 12), -2399, "card", "深圳华强北数码专营店", channel="online",
        card=virtual, city="深圳")
    add(at(today - timedelta(days=9), 2, 47), -1288, "card", "AMZN Mktp US", channel="overseas",
        card=debit, city="Seattle", country="US", status="declined")
    add(at(today - timedelta(days=2), 20, 15), -486, "card", "海底捞火锅(光谷店)", channel="pos", card=debit)

    session.add_all(txns)
    for payee in payees.values():
        paid = [t.at for t in txns if t.payee_id == payee.id and t.amount_fen < 0]
        payee.last_paid_at = max(paid) if paid else None

    session.add(Holding(user_id=user.id, product_code="WX0001", principal_fen=2_000_000,
                        value_fen=2_041_236, since=at(today - timedelta(days=430), 10),
                        updated_at=at(today, 0)))
    session.add(Holding(user_id=user.id, product_code="WX0102", principal_fen=1_000_000,
                        value_fen=1_026_890, since=at(today - timedelta(days=270), 10),
                        updated_at=at(today, 0)))
    session.add(RiskProfile(user_id=user.id, level=3, assessed_at=at(today - timedelta(days=240), 14),
                            answers=[]))
    session.flush()

    from app.bank.analysis import refresh_subscriptions

    refresh_subscriptions(session, user.id, today)


def has_bank(session: Session, user_id: str) -> bool:
    return session.exec(select(BankAccount.id).where(BankAccount.user_id == user_id)).first() is not None

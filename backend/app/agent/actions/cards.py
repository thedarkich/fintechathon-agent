"""Card management. Making a card safer is yellow; making it more usable again is red."""

from typing import Literal

from pydantic import Field
from sqlmodel import select

from app import clock
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.agent.resolve import Found, card_label, find_card
from app.bank import ledger
from app.models import Card
from app.money import to_fen, yuan

SWITCHES = {"online": ("online_enabled", "网上支付", "online payments"),
            "overseas": ("overseas_enabled", "境外支付", "overseas payments"),
            "atm": ("atm_enabled", "ATM 取现", "ATM withdrawals"),
            "contactless": ("contactless_enabled", "闪付", "contactless")}
MAX_LIMIT = {"debit": 5_000_000, "virtual": 1_000_000}


def pick_card(ctx: Ctx, text: str | None, statuses: set[str], verb_zh: str, verb_en: str) -> Card:
    return chosen_card(find_card(ctx.session, ctx.user.id, text, statuses=statuses), verb_zh, verb_en)


def chosen_card(found: Found, verb_zh: str, verb_en: str) -> Card:
    if found.value is not None:
        return found.value
    if found.options:
        raise Ask("card", f"要{verb_zh}哪张卡？", f"Which card should I {verb_en}?",
                  [{"value": c.last4, "label_zh": card_label(c, "zh"), "label_en": card_label(c, "en")} for c in found.options])
    raise Refuse("CARD_NOT_FOUND", f"没有可以{verb_zh}的卡。", f"There is no card I can {verb_en}.")


def card_fields(ctx: Ctx, c: Card) -> dict:
    return {"card_id": c.id, "card": card_label(c, "zh"), "card_en": card_label(c, "en"), "last4": c.last4}


class CardArgs(Args):
    card: str | None = Field(default=None, max_length=30)


# --- apply ---


class ApplyArgs(Args):
    kind: Literal["virtual", "debit"] = "virtual"
    purpose: str | None = Field(default=None, max_length=30)


def apply_run(ctx: Ctx, r: dict) -> dict:
    checking = ledger.checking(ctx.session, ctx.user.id)
    count = len(list(ctx.session.exec(select(Card.id).where(Card.user_id == ctx.user.id))))
    last4 = f"{(int(ctx.user.id[:6], 16) + count * 7919) % 10000:04d}"
    year = ctx.today.year % 100 + (3 if r["kind"] == "virtual" else 5)
    card = Card(user_id=ctx.user.id, kind=r["kind"], last4=last4, account_id=checking.id,
                name="虚拟卡" + (f"·{r['purpose']}" if r["purpose"] else "") if r["kind"] == "virtual" else "借记卡",
                name_en="Virtual card" + (f" ({r['purpose']})" if r["purpose"] else "") if r["kind"] == "virtual" else "Debit card",
                status="active" if r["kind"] == "virtual" else "pending",
                daily_limit_fen=200_000 if r["kind"] == "virtual" else 2_000_000,
                atm_enabled=r["kind"] != "virtual", contactless_enabled=r["kind"] != "virtual",
                expires=f"{ctx.today.month:02d}/{year:02d}", created_at=clock.iso(ctx.now))
    ctx.session.add(card)
    ctx.session.flush()
    return {"card_id": card.id, "last4": last4, "status": card.status, "daily_limit_fen": card.daily_limit_fen}


def apply_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    card = ctx.session.get(Card, res["card_id"])
    if card:
        card.status = "lost" if card.kind == "debit" else "frozen"
        ctx.session.add(card)
    return {"disabled": True}


register(Action(
    name="card_apply", args=ApplyArgs, help="Apply for a card. kind virtual (instant, online only) | debit (physical, mailed); purpose.",
    resolve=lambda ctx, a: {"kind": a.kind, "purpose": a.purpose}, run=apply_run,
    describe=lambda ctx, r: ctx.t("申请一张虚拟卡（立即可用，仅限网上支付，日限额 ¥2,000.00）" if r["kind"] == "virtual" else "申请一张实体借记卡（约 5 个工作日寄到）",
                                  "Apply for a virtual card (ready now, online only, ¥2,000.00 daily limit)" if r["kind"] == "virtual" else "Apply for a physical debit card (mailed in about 5 working days)"),
    reply=lambda ctx, r, res: ctx.t(f"新虚拟卡 ****{res['last4']} 已开通，日限额 {yuan(res['daily_limit_fen'])}。" if r["kind"] == "virtual" else f"实体卡申请已提交，卡号尾号 {res['last4']}，寄到后需激活。",
                                    f"Your new virtual card ****{res['last4']} is ready, daily limit {yuan(res['daily_limit_fen'])}." if r["kind"] == "virtual" else f"Debit card ****{res['last4']} has been requested; activate it when it arrives."),
    rule="Y_CARD_APPLY", compensate=apply_compensate,
    examples=["帮我申请一张虚拟卡", "I need a virtual card for online shopping"],
))


# --- freeze / unfreeze ---


def freeze_run(ctx: Ctx, r: dict) -> dict:
    card = ctx.session.get(Card, r["card_id"])
    card.status = "frozen"
    ctx.session.add(card)
    return {"status": "frozen"}


register(Action(
    name="card_freeze", args=CardArgs, help="Temporarily freeze a card (instantly reversible later with strong verification). card = last 4 digits or kind (virtual/debit).",
    resolve=lambda ctx, a: card_fields(ctx, pick_card(ctx, a.card, {"active"}, "冻结", "freeze")), run=freeze_run,
    describe=lambda ctx, r: ctx.t(f"临时冻结 {r['card']}，冻结期间所有交易都会被拒绝", f"Freeze {r['card_en']}; every payment is declined while frozen"),
    reply=lambda ctx, r, res: ctx.t(f"{r['card']} 已冻结。解冻需要强验证。如果卡找不回来，可以说“挂失尾号{r['last4']}的卡”。",
                                    f"{r['card_en']} is frozen. Unfreezing needs strong verification. If it's gone for good, say “report card {r['last4']} lost”."),
    rule="Y_RISK_REDUCING",
    examples=["冻结我的虚拟卡", "freeze card 0428"],
))


def unfreeze_run(ctx: Ctx, r: dict) -> dict:
    card = ctx.session.get(Card, r["card_id"])
    card.status = "active"
    ctx.session.add(card)
    return {"status": "active"}


register(Action(
    name="card_unfreeze", args=CardArgs, help="Unfreeze a frozen card. card = last 4 digits or kind (virtual/debit).",
    resolve=lambda ctx, a: card_fields(ctx, pick_card(ctx, a.card, {"frozen"}, "解冻", "unfreeze")), run=unfreeze_run,
    describe=lambda ctx, r: ctx.t(f"解冻 {r['card']}，恢复正常交易", f"Unfreeze {r['card_en']} so it works again"),
    reply=lambda ctx, r, res: ctx.t(f"{r['card']} 已解冻。", f"{r['card_en']} is active again."),
    rule="R_RISK_INCREASING", compensate=lambda ctx, r, res: freeze_run(ctx, r),
))


# --- restrictions ---


class RestrictArgs(Args):
    card: str | None = Field(default=None, max_length=30)
    online: bool | None = None
    overseas: bool | None = None
    atm: bool | None = None
    contactless: bool | None = None


def switch_changes(args: RestrictArgs, card: Card) -> dict:
    return {key: wanted for key, (attr, _, _) in SWITCHES.items()
            if (wanted := getattr(args, key)) is not None and wanted != getattr(card, attr)}


def restrict_resolve(ctx: Ctx, args: RestrictArgs) -> dict:
    wanted = {key: getattr(args, key) for key in SWITCHES if getattr(args, key) is not None}
    found = find_card(ctx.session, ctx.user.id, args.card, statuses={"active", "frozen"})
    if found.value is None and len(found.options) > 1 and wanted:
        # no single card named ("关闭境外交易"): only the cards this would change are worth asking about
        useful = [c for c in found.options if switch_changes(args, c)]
        if not useful:
            states_zh = "、".join(("开启" if on else "关闭") + SWITCHES[k][1] for k, on in wanted.items())
            states_en = ", ".join(f"{SWITCHES[k][2]} {'on' if on else 'off'}" for k, on in wanted.items())
            raise Refuse("NO_CHANGE", f"您的卡都已经{states_zh}了，不用再改。",
                         f"Every card already has {states_en}; nothing to change.")
        found = Found(value=useful[0]) if len(useful) == 1 else Found(options=useful)
    card = chosen_card(found, "设置", "change")
    changes = switch_changes(args, card)
    if not changes:
        raise Refuse("NO_CHANGE", "这张卡已经是这个设置了。", "The card is already set that way.")
    return {**card_fields(ctx, card), "changes": changes}


def restrict_rule(ctx: Ctx, r: dict) -> str:
    return "R_RISK_INCREASING" if any(r["changes"].values()) else "Y_RISK_REDUCING"


def restrict_run(ctx: Ctx, r: dict) -> dict:
    card = ctx.session.get(Card, r["card_id"])
    before = {}
    for key, value in r["changes"].items():
        attr = SWITCHES[key][0]
        before[key] = getattr(card, attr)
        setattr(card, attr, value)
    ctx.session.add(card)
    return {"before": before, "after": r["changes"]}


def restrict_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    card = ctx.session.get(Card, r["card_id"])
    for key, value in res["after"].items():
        if value:  # only switch back things that were turned on; never re-open something closed
            setattr(card, SWITCHES[key][0], False)
    ctx.session.add(card)
    return {"restored": True}


def restrict_describe(ctx: Ctx, r: dict) -> str:
    parts = [ctx.t(("开启" if on else "关闭") + SWITCHES[k][1], ("turn on " if on else "turn off ") + SWITCHES[k][2])
             for k, on in r["changes"].items()]
    return ctx.t(f"{r['card']}：" + "、".join(parts), f"{r['card_en']}: " + ", ".join(parts))


register(Action(
    name="card_restrict", args=RestrictArgs,
    help="Turn card features on/off: online, overseas, atm, contactless (true/false). Turning anything on is high risk.",
    resolve=restrict_resolve, run=restrict_run, describe=restrict_describe,
    reply=lambda ctx, r, res: ctx.t("已更新：", "Updated: ") + restrict_describe(ctx, r),
    rule=restrict_rule, compensate=restrict_compensate,
    examples=["关闭境外支付", "turn on overseas payments for my debit card"],
))


# --- limits ---


class LimitArgs(Args):
    card: str | None = Field(default=None, max_length=30)
    daily_limit_yuan: float | None = Field(default=None, gt=0)


def limit_resolve(ctx: Ctx, args: LimitArgs) -> dict:
    card = pick_card(ctx, args.card, {"active", "frozen"}, "调整限额", "change the limit of")
    if args.daily_limit_yuan is None:
        raise Ask("daily_limit_yuan", f"{card_label(card, 'zh')} 目前日限额 {yuan(card.daily_limit_fen)}，调整为多少？",
                  f"{card_label(card, 'en')} has a {yuan(card.daily_limit_fen)} daily limit. What should it be?")
    fen = to_fen(args.daily_limit_yuan)
    if not 10_000 <= fen <= MAX_LIMIT[card.kind]:
        raise Refuse("LIMIT_RANGE", f"该卡日限额可设为 ¥100.00 至 {yuan(MAX_LIMIT[card.kind])}。",
                     f"This card's daily limit can be ¥100.00 to {yuan(MAX_LIMIT[card.kind])}.")
    if fen == card.daily_limit_fen:
        raise Refuse("NO_CHANGE", "限额没有变化。", "That is already the limit.")
    return {**card_fields(ctx, card), "old_fen": card.daily_limit_fen, "fen": fen}


def limit_run(ctx: Ctx, r: dict) -> dict:
    card = ctx.session.get(Card, r["card_id"])
    card.daily_limit_fen = r["fen"]
    ctx.session.add(card)
    return {"fen": r["fen"]}


def limit_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    if r["fen"] > r["old_fen"]:  # undo only a raise
        card = ctx.session.get(Card, r["card_id"])
        card.daily_limit_fen = r["old_fen"]
        ctx.session.add(card)
    return {"restored": r["fen"] > r["old_fen"]}


register(Action(
    name="card_limit", args=LimitArgs, help="Change a card's daily limit (daily_limit_yuan). Raising is high risk; lowering is low risk.",
    resolve=limit_resolve, run=limit_run,
    describe=lambda ctx, r: ctx.t(f"{r['card']} 日限额 {yuan(r['old_fen'])} → {yuan(r['fen'])}", f"{r['card_en']} daily limit {yuan(r['old_fen'])} → {yuan(r['fen'])}"),
    reply=lambda ctx, r, res: ctx.t(f"{r['card']} 日限额已改为 {yuan(res['fen'])}。", f"{r['card_en']} daily limit is now {yuan(res['fen'])}."),
    rule=lambda ctx, r: "R_RISK_INCREASING" if r["fen"] > r["old_fen"] else "Y_RISK_REDUCING",
    compensate=limit_compensate,
))


# --- loss report ---


class LostArgs(Args):
    card: str | None = Field(default=None, max_length=30)
    reissue: bool = True


def lost_resolve(ctx: Ctx, args: LostArgs) -> dict:
    card = pick_card(ctx, args.card, {"active", "frozen"}, "挂失", "report lost")
    return {**card_fields(ctx, card), "reissue": args.reissue, "kind": card.kind}


def lost_run(ctx: Ctx, r: dict) -> dict:
    card = ctx.session.get(Card, r["card_id"])
    card.status = "lost"
    card.online_enabled = card.overseas_enabled = card.atm_enabled = card.contactless_enabled = False
    ctx.session.add(card)
    replacement = None
    if r["reissue"]:
        replacement = apply_run(ctx, {"kind": card.kind, "purpose": None})
    return {"status": "lost", "replacement": replacement}


register(Action(
    name="card_report_lost", args=LostArgs, help="Report a card lost (挂失, permanent). card = last 4 digits or kind; reissue true|false. Only when the customer asks to report it.",
    resolve=lost_resolve, run=lost_run,
    describe=lambda ctx, r: ctx.t(f"挂失 {r['card']}（永久停用）" + ("并补办新卡" if r["reissue"] else ""),
                                  f"Report {r['card_en']} lost (permanently disabled)" + (" and order a replacement" if r["reissue"] else "")),
    reply=lambda ctx, r, res: ctx.t(f"{r['card']} 已挂失。" + (f"新卡尾号 {res['replacement']['last4']}。" if res["replacement"] else ""),
                                    f"{r['card_en']} is reported lost." + (f" Replacement card ends {res['replacement']['last4']}." if res["replacement"] else "")),
    rule="R_CARD_LOSS",
    examples=["我的卡丢了", "my card was stolen"],
))

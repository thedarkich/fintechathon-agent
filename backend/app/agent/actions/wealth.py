"""Wealth: holdings and returns (green), comparison and suitability-checked recommendations (green),
risk questionnaire (yellow), redemption (yellow) and purchase (red). Products are simulated."""

from datetime import timedelta

from pydantic import Field
from sqlmodel import select

from app import clock
from app.agent.core import Action, Args, Ask, Ctx, Refuse, register
from app.agent.resolve import find_holding, find_product
from app.bank import ledger
from app.models import Holding, RiskProfile, WealthProduct
from app.money import bp, to_fen, yuan

LEVEL = {1: ("保守型 C1", "Conservative (C1)"), 2: ("稳健型 C2", "Cautious (C2)"), 3: ("平衡型 C3", "Balanced (C3)"),
         4: ("成长型 C4", "Growth (C4)"), 5: ("进取型 C5", "Aggressive (C5)")}
KIND = {"money_market": ("货币基金", "money-market fund"), "bond": ("债券基金", "bond fund"),
        "mixed": ("混合基金", "mixed fund"), "equity": ("股票基金", "equity fund"), "qdii": ("QDII 基金", "QDII fund")}
DISCLAIMER = ("以上为模拟产品，仅用于演示，不构成投资建议。", "These are simulated demo products, not investment advice.")

QUESTIONS = [
    ("您的投资经验？", "Your investing experience?", ["没有", "2 年以内", "2–5 年", "5 年以上"], ["None", "Under 2 years", "2–5 years", "Over 5 years"]),
    ("这笔钱多久不用？", "How long until you need this money?", ["1 年内", "1–3 年", "3–5 年", "5 年以上"], ["Within 1 year", "1–3 years", "3–5 years", "Over 5 years"]),
    ("能接受的最大亏损？", "The largest loss you could accept?", ["5% 以内", "5–15%", "15–30%", "30% 以上"], ["Under 5%", "5–15%", "15–30%", "Over 30%"]),
    ("投资占收入的比例？", "Share of income you invest?", ["10% 以下", "10–25%", "25–50%", "50% 以上"], ["Under 10%", "10–25%", "25–50%", "Over 50%"]),
    ("如果一个月跌了 20%，您会？", "If it fell 20% in a month, you would…", ["全部卖出", "卖出一部分", "继续持有", "加仓"], ["Sell everything", "Sell some", "Hold", "Buy more"]),
]


def profile(ctx: Ctx) -> RiskProfile | None:
    return ctx.session.get(RiskProfile, ctx.user.id)


def product_view(p: WealthProduct, ctx: Ctx, level: int | None) -> dict:
    return {"code": p.code, "name": p.name if ctx.lang == "zh" else p.name_en, "kind": p.kind, "risk_level": p.risk_level,
            "yield_bp": p.annual_yield_bp, "return_1y_bp": p.return_1y_bp, "max_drawdown_bp": p.max_drawdown_bp,
            "min_fen": p.min_fen, "redeem_days": p.redeem_days, "fee_bp": p.fee_bp,
            "description": p.description if ctx.lang == "zh" else p.description_en,
            "suitable": level is not None and p.risk_level <= level}


# --- holdings ---


def holdings_run(ctx: Ctx, r: dict) -> dict:
    rows = list(ctx.session.exec(select(Holding).where(Holding.user_id == ctx.user.id)))
    items = []
    for h in rows:
        p = ctx.session.get(WealthProduct, h.product_code)
        items.append({"code": h.product_code, "name": p.name if ctx.lang == "zh" else p.name_en, "principal_fen": h.principal_fen,
                      "value_fen": h.value_fen, "gain_fen": h.value_fen - h.principal_fen,
                      "return_pct": round((h.value_fen - h.principal_fen) / h.principal_fen * 100, 2) if h.principal_fen else 0,
                      "since": h.since[:10], "risk_level": p.risk_level})
    p = profile(ctx)
    return {"items": items, "value_fen": sum(i["value_fen"] for i in items), "gain_fen": sum(i["gain_fen"] for i in items),
            "profile_level": p.level if p else None, "assessed_on": p.assessed_at[:10] if p else None}


def holdings_reply(ctx: Ctx, r: dict, res: dict) -> str:
    level = res.get("profile_level")
    risk = ctx.t(f"您的风险测评结果：{LEVEL[level][0]}（{res['assessed_on']} 评估）。", f"Your risk profile: {LEVEL[level][1]}, assessed {res['assessed_on']}.") \
        if level else ctx.t("您还没有做过风险测评。", "You have not taken the risk questionnaire yet.")
    if not res["items"]:
        return ctx.t("您目前没有理财持仓。", "You hold no investments.") + "\n" + risk
    lines = [ctx.t(f"理财总市值 {yuan(res['value_fen'])}，累计收益 {yuan(res['gain_fen'])}：",
                   f"Investments worth {yuan(res['value_fen'])}, total gain {yuan(res['gain_fen'])}:")]
    lines += [ctx.t(f"· {i['name']}：本金 {yuan(i['principal_fen'])}，市值 {yuan(i['value_fen'])}，收益 {yuan(i['gain_fen'])}（{i['return_pct']:+.2f}%），{i['since']} 起",
                    f"· {i['name']}: invested {yuan(i['principal_fen'])}, now {yuan(i['value_fen'])}, gain {yuan(i['gain_fen'])} ({i['return_pct']:+.2f}%) since {i['since']}")
              for i in res["items"]]
    return "\n".join([*lines, risk])


register(Action(
    name="wealth_holdings", args=Args, help="Investment holdings, value and returns, and the customer's risk profile (questionnaire level).",
    resolve=lambda ctx, a: {}, run=holdings_run,
    describe=lambda ctx, r: ctx.t("查看理财持仓", "Show investments"), reply=holdings_reply,
    card=lambda ctx, r, res: {"type": "holdings", **res},
    examples=["我的理财收益怎么样", "how are my investments doing"],
))


# --- products, comparison, recommendation ---


class ProductsArgs(Args):
    risk_max: int | None = Field(default=None, ge=1, le=5)
    kind: str | None = Field(default=None, max_length=20)


def products_run(ctx: Ctx, r: dict) -> dict:
    level = profile(ctx).level if profile(ctx) else None
    rows = [p for p in ctx.session.exec(select(WealthProduct).order_by(WealthProduct.risk_level))
            if (r["risk_max"] is None or p.risk_level <= r["risk_max"]) and (not r["kind"] or p.kind == r["kind"])]
    return {"items": [product_view(p, ctx, level) for p in rows], "level": level}


def product_line(ctx: Ctx, p: dict) -> str:
    ret = ctx.t(f"七日年化 {bp(p['yield_bp'])}", f"7-day annualised {bp(p['yield_bp'])}") if p["yield_bp"] else \
        ctx.t(f"近一年 {bp(p['return_1y_bp'])}，最大回撤 {bp(p['max_drawdown_bp'])}", f"1-year {bp(p['return_1y_bp'])}, max drawdown {bp(p['max_drawdown_bp'])}")
    fit = "" if p["suitable"] else ctx.t("（超出您的风险等级）", " (above your risk level)")
    return f"· {p['name']} R{p['risk_level']} {KIND[p['kind']][0 if ctx.lang == 'zh' else 1]}，{ret}{fit}" if ctx.lang == "zh" \
        else f"· {p['name']} R{p['risk_level']} {KIND[p['kind']][1]}, {ret}{fit}"


register(Action(
    name="wealth_products", args=ProductsArgs, help="List investment products, optional risk_max 1-5 and kind.",
    resolve=lambda ctx, a: {"risk_max": a.risk_max, "kind": a.kind}, run=products_run,
    describe=lambda ctx, r: ctx.t("查看理财产品", "List products"),
    reply=lambda ctx, r, res: "\n".join([product_line(ctx, p) for p in res["items"]] + [ctx.t(*DISCLAIMER)]),
    card=lambda ctx, r, res: {"type": "products", **res},
))


class CompareArgs(Args):
    products: list[str] = Field(min_length=2, max_length=4)


def compare_resolve(ctx: Ctx, args: CompareArgs) -> dict:
    codes = []
    for text in args.products:
        found = find_product(ctx.session, text)
        if found.value is None:
            raise Refuse("PRODUCT_NOT_FOUND", f"没有找到产品“{text}”。", f"No product matches “{text}”.")
        codes.append(found.value.code)
    return {"codes": list(dict.fromkeys(codes))}


def compare_run(ctx: Ctx, r: dict) -> dict:
    level = profile(ctx).level if profile(ctx) else None
    items = [product_view(ctx.session.get(WealthProduct, c), ctx, level) for c in r["codes"]]
    # the conclusion is the bank's, by fixed rule: the lower risk level, then the smaller worst fall
    safer = min(items, key=lambda p: (p["risk_level"], p["max_drawdown_bp"]))
    return {"items": items, "level": level, "safer": safer["code"]}


def compare_reply(ctx: Ctx, r: dict, res: dict) -> str:
    lines = [product_line(ctx, p) + ctx.t(f"，起购 {yuan(p['min_fen'])}，赎回 T+{p['redeem_days']}，费率 {bp(p['fee_bp'])}",
                                          f", minimum {yuan(p['min_fen'])}, redemption T+{p['redeem_days']}, fee {bp(p['fee_bp'])}")
             for p in res["items"]]
    lines.insert(0, ctx.t(f"{len(res['items'])} 款产品对比：", f"Comparing {len(res['items'])} products:"))
    safer = next((p for p in res["items"] if p["code"] == res.get("safer")), None) or \
        min(res["items"], key=lambda p: (p["risk_level"], p["max_drawdown_bp"]))
    lines.append(ctx.t(f"风险更低的是 {safer['name']}；收益更高的产品通常波动也更大。", f"Lower risk: {safer['name']}. Higher returns usually come with larger swings."))
    lines.append(ctx.t(*DISCLAIMER))
    return "\n".join(lines)


register(Action(
    name="wealth_compare", args=CompareArgs, help="Compare 2-4 products. products = list of names, codes or types (货币/债/混合/股票/QDII).",
    resolve=compare_resolve, run=compare_run,
    describe=lambda ctx, r: ctx.t("对比理财产品", "Compare products"), reply=compare_reply,
    card=lambda ctx, r, res: {"type": "compare", **res},
))


class RecommendArgs(Args):
    amount_yuan: float | None = Field(default=None, gt=0)
    horizon_months: int | None = Field(default=None, ge=1, le=360)
    goal: str | None = Field(default=None, max_length=60)


def recommend_resolve(ctx: Ctx, args: RecommendArgs) -> dict:
    p = profile(ctx)
    if p is None:
        raise Ask("risk_assessment", "推荐前需要先完成风险测评。", "I need your risk assessment before recommending anything.")
    if args.horizon_months is None:
        raise Ask("horizon_months", "这笔钱大概多久不用？", "Roughly how long can this money stay invested?",
                  [{"value": v, "label_zh": zh, "label_en": en} for v, zh, en in
                   ((3, "3 个月内", "Under 3 months"), (12, "1 年左右", "About a year"), (36, "3 年以上", "3+ years"))])
    return {"amount_fen": to_fen(args.amount_yuan) if args.amount_yuan else None, "horizon": args.horizon_months,
            "level": p.level, "stale": (ctx.today - clock.to_date(p.assessed_at)).days > 365}


def recommend_run(ctx: Ctx, r: dict) -> dict:
    products = {p.code: p for p in ctx.session.exec(select(WealthProduct))}
    if r["horizon"] < 3:
        wanted = ["WX0001"]
    elif r["horizon"] < 12:
        wanted = ["WX0102", "WX0001"]
    elif r["horizon"] < 36:
        wanted = ["WX0205", "WX0102"]
    else:
        wanted = ["WX0310", "WX0205", "WX0102"]
    picks = [products[c] for c in wanted if products[c].risk_level <= r["level"]] or [products["WX0001"]]
    excluded = [products[c] for c in wanted if products[c].risk_level > r["level"]]
    return {"items": [product_view(p, ctx, r["level"]) for p in picks],
            "excluded": [product_view(p, ctx, r["level"]) for p in excluded], "level": r["level"]}


def recommend_reply(ctx: Ctx, r: dict, res: dict) -> str:
    level = LEVEL[r["level"]][0 if ctx.lang == "zh" else 1]
    lines = [ctx.t(f"按您的风险等级（{level}）和期限，适合的产品：", f"Suitable for your risk level ({level}) and time frame:")]
    lines += [product_line(ctx, p) for p in res["items"]]
    if res["excluded"]:
        names = "、".join(p["name"] for p in res["excluded"])
        lines.append(ctx.t(f"未推荐 {names}：风险等级高于您的测评结果。", f"Not recommended: {names}, which is above your risk level."))
    if r["stale"]:
        lines.append(ctx.t("您的风险测评已超过一年，建议重新测评。", "Your risk assessment is over a year old; please redo it."))
    lines.append(ctx.t(*DISCLAIMER))
    return "\n".join(lines)


register(Action(
    name="wealth_recommend", args=RecommendArgs, help="Recommend products that fit the risk profile. amount_yuan, horizon_months, goal.",
    resolve=recommend_resolve, run=recommend_run,
    describe=lambda ctx, r: ctx.t("推荐理财产品", "Recommend products"), reply=recommend_reply,
    card=lambda ctx, r, res: {"type": "products", **res},
    examples=["有10万闲钱一年不用，买什么好", "recommend something for 20000 for 3 years"],
))


# --- risk questionnaire ---


class RiskArgs(Args):
    answers: list[int] | None = Field(default=None, min_length=5, max_length=5)


def risk_resolve(ctx: Ctx, args: RiskArgs) -> dict:
    if args.answers is None or any(a not in (1, 2, 3, 4) for a in args.answers):
        raise Ask("answers", "请完成以下 5 道风险测评题。", "Please answer these five risk questions.",
                  [{"question_zh": q, "question_en": qe, "choices_zh": c, "choices_en": ce} for q, qe, c, ce in QUESTIONS])
    score = sum(args.answers)
    level = 1 if score <= 7 else 2 if score <= 10 else 3 if score <= 13 else 4 if score <= 16 else 5
    old = profile(ctx)
    return {"answers": args.answers, "score": score, "level": level, "old_level": old.level if old else None}


def risk_run(ctx: Ctx, r: dict) -> dict:
    row = profile(ctx) or RiskProfile(user_id=ctx.user.id, level=r["level"], assessed_at=clock.iso(ctx.now))
    row.level, row.assessed_at, row.answers = r["level"], clock.iso(ctx.now), r["answers"]
    ctx.session.add(row)
    return {"level": r["level"]}


register(Action(
    name="risk_assessment", args=RiskArgs, help="Risk questionnaire. answers: five integers 1-4 (omit to show the questions).",
    resolve=risk_resolve, run=risk_run,
    describe=lambda ctx, r: ctx.t(f"更新风险等级为 {LEVEL[r['level']][0]}（得分 {r['score']}）", f"Set risk level to {LEVEL[r['level']][1]} (score {r['score']})"),
    reply=lambda ctx, r, res: ctx.t(f"风险测评已更新：{LEVEL[res['level']][0]}。", f"Risk profile updated: {LEVEL[res['level']][1]}."),
    rule="Y_PROFILE_CHANGE",
))


# --- buy and sell ---


class SubscribeArgs(Args):
    product: str = Field(min_length=1, max_length=30)
    amount_yuan: float | None = Field(default=None, gt=0)


def subscribe_resolve(ctx: Ctx, args: SubscribeArgs) -> dict:
    found = find_product(ctx.session, args.product)
    if found.value is None:
        if found.options:
            raise Ask("product", "是哪一款产品？", "Which product?",
                      [{"value": p.code, "label_zh": f"{p.name} R{p.risk_level}", "label_en": f"{p.name_en} R{p.risk_level}"} for p in found.options])
        raise Refuse("PRODUCT_NOT_FOUND", f"没有找到产品“{args.product}”。", f"No product matches “{args.product}”.")
    product = found.value
    p = profile(ctx)
    if p is None or (ctx.today - clock.to_date(p.assessed_at)).days > 365:
        raise Refuse("NEEDS_ASSESSMENT", "购买前需要完成（或更新）风险测评。", "Please complete (or renew) your risk assessment before buying.")
    if product.risk_level > p.level:
        raise Refuse("NOT_SUITABLE", f"{product.name} 风险等级 R{product.risk_level} 高于您的测评结果 C{p.level}，按适当性要求不能购买。",
                     f"{product.name_en} is R{product.risk_level}, above your C{p.level} profile, so it cannot be bought (suitability rule).")
    if args.amount_yuan is None:
        raise Ask("amount_yuan", f"买多少？起购金额 {yuan(product.min_fen)}。", f"How much? The minimum is {yuan(product.min_fen)}.")
    fen = to_fen(args.amount_yuan)
    if fen < product.min_fen:
        raise Refuse("BELOW_MINIMUM", f"起购金额为 {yuan(product.min_fen)}。", f"The minimum is {yuan(product.min_fen)}.")
    if ledger.checking(ctx.session, ctx.user.id).balance_fen < fen:
        raise Refuse("INSUFFICIENT_FUNDS", "活期余额不足。", "Not enough in the current account.")
    return {"code": product.code, "product": product.name, "product_en": product.name_en, "risk_level": product.risk_level,
            "fen": fen, "fee_bp": product.fee_bp, "level": p.level}


def subscribe_run(ctx: Ctx, r: dict) -> dict:
    source = ledger.checking(ctx.session, ctx.user.id)
    txn = ledger.debit(ctx.session, source, r["fen"], when=ctx.now, kind="wealth", counterparty=r["product"],
                       plan_id=ctx.plan.id if ctx.plan else None, category="wealth")
    holding = ctx.session.exec(select(Holding).where(Holding.user_id == ctx.user.id, Holding.product_code == r["code"])).first()
    invested = r["fen"] - r["fen"] * r["fee_bp"] // 10_000
    if holding is None:
        holding = Holding(user_id=ctx.user.id, product_code=r["code"], principal_fen=0, value_fen=0,
                          since=clock.iso(ctx.now), updated_at=clock.iso(ctx.now))
    holding.principal_fen += r["fen"]
    holding.value_fen += invested
    holding.updated_at = clock.iso(ctx.now)
    ctx.session.add(holding)
    return {"txn_id": txn.id, "fen": r["fen"], "invested_fen": invested}


def subscribe_compensate(ctx: Ctx, r: dict, res: dict) -> dict:
    holding = ctx.session.exec(select(Holding).where(Holding.user_id == ctx.user.id, Holding.product_code == r["code"])).first()
    if holding:
        holding.principal_fen -= r["fen"]
        holding.value_fen -= res["invested_fen"]
        if holding.principal_fen <= 0:
            ctx.session.delete(holding)
        else:
            ctx.session.add(holding)
    ledger.credit(ctx.session, ledger.checking(ctx.session, ctx.user.id), r["fen"], when=ctx.now, kind="refund",
                  counterparty=r["product"], memo=ctx.t("申购撤销", "Purchase reversed"), category="wealth")
    return {"refunded": True}


register(Action(
    name="wealth_subscribe", args=SubscribeArgs, help="Buy an investment product (suitability checked). product, amount_yuan.",
    resolve=subscribe_resolve, run=subscribe_run,
    describe=lambda ctx, r: ctx.t(f"从活期申购 {r['product']}（R{r['risk_level']}）{yuan(r['fen'])}，费率 {bp(r['fee_bp'])}",
                                  f"Buy {yuan(r['fen'])} of {r['product_en']} (R{r['risk_level']}) from the current account, fee {bp(r['fee_bp'])}"),
    reply=lambda ctx, r, res: ctx.t(f"已申购 {r['product']} {yuan(res['fen'])}（扣除费用后计入 {yuan(res['invested_fen'])}）。模拟产品，不构成投资建议。",
                                    f"Bought {yuan(res['fen'])} of {r['product_en']} ({yuan(res['invested_fen'])} after fees). Simulated product, not advice."),
    rule="R_INVESTMENT", compensate=subscribe_compensate,
))


class RedeemArgs(Args):
    product: str | None = Field(default=None, max_length=30)
    amount_yuan: float | None = Field(default=None, gt=0)


def redeem_resolve(ctx: Ctx, args: RedeemArgs) -> dict:
    found = find_holding(ctx.session, ctx.user.id, args.product)
    if found.value is None:
        if found.options:
            raise Ask("product", "赎回哪一个持仓？", "Which holding should I redeem?",
                      [{"value": h.product_code, "label_zh": f"{ctx.session.get(WealthProduct, h.product_code).name} {yuan(h.value_fen)}",
                        "label_en": f"{ctx.session.get(WealthProduct, h.product_code).name_en} {yuan(h.value_fen)}"} for h in found.options])
        raise Refuse("NO_HOLDING", "没有找到对应的持仓。", "No matching holding.")
    holding = found.value
    product = ctx.session.get(WealthProduct, holding.product_code)
    fen = holding.value_fen if args.amount_yuan is None else to_fen(args.amount_yuan)
    if fen > holding.value_fen:
        raise Refuse("OVER_HOLDING", f"持仓市值只有 {yuan(holding.value_fen)}。", f"The holding is only worth {yuan(holding.value_fen)}.")
    arrives = ctx.today + timedelta(days=product.redeem_days)
    return {"code": product.code, "product": product.name, "product_en": product.name_en, "fen": fen,
            "all": fen == holding.value_fen, "redeem_days": product.redeem_days, "arrives_on": arrives.isoformat()}


def redeem_run(ctx: Ctx, r: dict) -> dict:
    holding = ctx.session.exec(select(Holding).where(Holding.user_id == ctx.user.id, Holding.product_code == r["code"])).first()
    share = r["fen"] / holding.value_fen
    holding.principal_fen -= round(holding.principal_fen * share)
    holding.value_fen -= r["fen"]
    if holding.value_fen <= 0:
        ctx.session.delete(holding)
    else:
        ctx.session.add(holding)
    ledger.credit(ctx.session, ledger.checking(ctx.session, ctx.user.id), r["fen"], when=ctx.now, kind="wealth",
                  counterparty=r["product"], memo=ctx.t("理财赎回", "Redemption"), category="wealth",
                  plan_id=ctx.plan.id if ctx.plan else None)
    return {"fen": r["fen"]}


register(Action(
    name="wealth_redeem", args=RedeemArgs, help="Sell (redeem) an investment back to the current account. product, amount_yuan (omit = all).",
    resolve=redeem_resolve, run=redeem_run,
    describe=lambda ctx, r: ctx.t(f"赎回 {r['product']} {yuan(r['fen'])} 到活期（真实产品 T+{r['redeem_days']} 到账，演示中立即到账）",
                                  f"Redeem {yuan(r['fen'])} of {r['product_en']} to the current account (a real fund settles T+{r['redeem_days']}; the demo credits now)"),
    reply=lambda ctx, r, res: ctx.t(f"已赎回 {yuan(res['fen'])}，已存入活期账户。", f"Redeemed {yuan(res['fen'])} into your current account."),
    rule="Y_WEALTH_REDEEM",
))

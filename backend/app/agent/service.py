"""One customer turn: screen → plan → validate → prepare → reply, with every stage audited."""

import re

from sqlmodel import Session, select

from app import clock
from app.agent import audit, executor, locks, offline, replies, screening
from app.agent.core import Ctx
from app.agent.planner import Planner, PlanOut, validate
from app.llm import ModelUnavailable
from app.models import Conversation, Message, Plan, Upload, UserAccount

NUMERIC_FIELDS = {"amount_yuan", "total_yuan", "daily_limit_yuan", "horizon_months"}


def detect_lang(text: str, fallback: str) -> str:
    if re.search(r"[一-鿿]", text):
        return "zh"
    if re.search(r"[A-Za-z]{2,}", text):
        return "en"
    return fallback if fallback in ("zh", "en") else "zh"


def conversation_for(session: Session, user: UserAccount, conversation_id: str | None) -> Conversation:
    if conversation_id:
        conversation = session.get(Conversation, conversation_id)
        if conversation and conversation.user_id == user.id:
            return conversation
    conversation = session.exec(select(Conversation).where(Conversation.user_id == user.id, Conversation.hidden.is_not(True))
                                .order_by(Conversation.created_at.desc()).limit(1)).first()
    if conversation is None:
        conversation = Conversation(user_id=user.id)
        session.add(conversation)
        session.flush()
    return conversation


def history(session: Session, conversation_id: str) -> list[str]:
    rows = session.exec(select(Message).where(Message.conversation_id == conversation_id)
                        .order_by(Message.at.desc()).limit(8)).all()
    lines = []
    for m in reversed(rows):
        if m.role == "user":
            lines.append(f"Customer: {m.text}")
        elif m.summary:
            lines.append(f"Bank: {m.summary}")
    return lines


def add_message(session: Session, ctx: Ctx, conversation: Conversation, role: str, text: str, *,
                plan_id: str | None = None, cards: list | None = None, summary: str | None = None) -> Message:
    message = Message(conversation_id=conversation.id, user_id=ctx.user.id, role=role, text=text, lang=ctx.lang,
                      plan_id=plan_id, cards=cards or [], summary=summary)
    session.add(message)
    session.flush()
    return message


def reply_for_plan(session: Session, ctx: Ctx, conversation: Conversation, plan: Plan) -> Message:
    text, cards, summary = replies.compose(ctx, plan)
    session.add(plan)
    return add_message(session, ctx, conversation, "assistant", text, plan_id=plan.id, cards=cards, summary=summary)


def option_match(plan: Plan, text: str):
    options = (plan.ask or {}).get("options") or []
    value = text.strip().casefold()
    index = re.fullmatch(r"(?:第)?([1-9])(?:个|位|项)?|(?:option )?([1-9])", value)
    if index:
        position = int(index.group(1) or index.group(2)) - 1
        if 0 <= position < len(options) and "value" in options[position]:
            return options[position]["value"]
    for option in options:
        labels = [str(option.get("value", "")), option.get("label_zh", ""), option.get("label_en", "")]
        if any(value and (value == label.casefold() or (len(value) >= 2 and value in label.casefold())) for label in labels):
            return option.get("value")
    return None


async def handle(session: Session, user: UserAccount, planner: Planner, text: str, *, conversation_id: str | None = None,
                 lang: str = "zh", attachment_id: str | None = None) -> tuple[Conversation, list[Message], Plan | None]:
    now = clock.now(session, user.id)
    ctx = Ctx(session=session, user=user, now=now, lang=detect_lang(text, lang))
    conversation = conversation_for(session, user, conversation_id)
    clean, hidden = screening.redact(text)
    attachment = session.get(Upload, attachment_id) if attachment_id else None
    if attachment is not None and attachment.user_id != user.id:
        attachment = None
    user_message = add_message(session, ctx, conversation, "user", clean, cards=[
        {"type": "attachment", "upload_id": attachment.id, "kind": attachment.kind,
         "preview": f"/api/uploads/{attachment.id}/preview"}] if attachment else None)
    audit.append(session, user.id, "request", {"text": clean, "lang": ctx.lang, "secret_hidden": hidden,
                                               "conversation": conversation.id,
                                               "attachment": attachment.id if attachment else None})
    out: list[Message] = [user_message]

    if conversation.escalated:
        out.append(add_message(session, ctx, conversation, "system", ctx.t(
            "人工客服已接手本次对话，请稍候，工作人员会在这里回复。", "A bank operator has taken over this conversation and will reply here.")))
        session.commit()
        return conversation, out, None

    if hidden:
        out.append(add_message(session, ctx, conversation, "assistant", ctx.t(
            "为了安全，我已隐藏您消息里的密码或验证码。请不要在聊天中输入它们，需要时我会弹出专门的验证窗口。",
            "For your safety I hid the password or code in your message. Never type them in chat; I'll open a separate verification window when one is needed.")))

    agent_lock = next((lock for lock in locks.active(session, user.id) if lock.scope == "agent"), None)
    if agent_lock:
        out.append(add_message(session, ctx, conversation, "assistant", locks.describe(agent_lock, ctx.lang),
                               cards=[{"type": "lock", "scope": "agent", "reason": agent_lock.reason}]))
        session.commit()
        return conversation, out, None

    flags = screening.screen(text)
    if flags:
        audit.append(session, user.id, "screening", {"flags": flags})
        locks.evaluate(session, user.id)

    # an answer to the open question on the latest plan
    pending = session.exec(select(Plan).where(Plan.conversation_id == conversation.id, Plan.status == "clarifying")
                           .order_by(Plan.created_at.desc()).limit(1)).first()
    if pending and pending.ask:
        answer = option_match(pending, clean)
        if answer is None and pending.ask["field"] in NUMERIC_FIELDS:
            numbers = offline.amounts(clean)
            if len(numbers) == 1 and len(clean) <= 16:
                answer = numbers[0]
        if answer is None and pending.ask["field"] == "when":
            moment, _ = offline.when_from(clean, ctx.today)
            answer = moment
        if answer is not None:
            ctx.plan = pending
            plan = executor.answer(ctx, pending, answer)
            out.append(reply_for_plan(session, ctx, conversation, plan))
            session.commit()
            return conversation, out, plan
        pending.status = "cancelled"
        session.add(pending)

    versions: dict = {}
    source = "offline"
    proposed: PlanOut | None = None
    # the planner learns only that a receipt is attached (its id), never what it says
    planner_text = clean + (f"\n[Attached receipt id: {attachment.id}]" if attachment else "")
    if planner.online:
        try:
            proposed = await planner.plan_with_model(planner_text, history(session, conversation.id)[:-1], ctx.today, versions)
            source = "ai"
        except ModelUnavailable as exc:
            audit.append(session, user.id, "model_unavailable", {"code": exc.code})
            if exc.code == "MODEL_OUTPUT_INVALID":  # counts towards the misbehaving-model lock
                audit.append(session, user.id, "plan_rejected", {"errors": ["SCHEMA"]})
                locks.evaluate(session, user.id)
            source = "offline_fallback"
    if proposed is None:
        proposed = offline.plan(clean, ctx.today, suspicious=bool(flags), attachment=attachment.id if attachment else None)
    errors = validate(proposed, planner_text)
    audit.append(session, user.id, "plan_proposed", {"source": source, "model": versions.get("planner"),
                                                     "plan": proposed.model_dump(), "errors": errors})
    if errors:
        audit.append(session, user.id, "plan_rejected", {"errors": errors})
        locks.evaluate(session, user.id)
        out.append(add_message(session, ctx, conversation, "assistant", ctx.t(
            "抱歉，我没能为这个请求生成安全有效的操作计划，请换个说法再试一次。",
            "Sorry, I couldn't turn that into a safe, valid plan. Please try saying it another way."),
            summary="[rejected plan]"))
        session.commit()
        return conversation, out, None
    if not proposed.steps:
        question = proposed.ask or offline.ask(*offline.HELP).ask
        text = question.zh if ctx.lang == "zh" else question.en
        last = session.exec(select(Message).where(Message.conversation_id == conversation.id, Message.role == "assistant")
                            .order_by(Message.at.desc()).limit(1)).first()
        if last is not None and (last.summary or "").startswith("[asked]"):
            # the second unclear message in a row: offer a person rather than only asking again
            text += ctx.t("\n如果不好说清楚，可以说“转人工”，由工作人员帮您。",
                          "\nIf it's hard to put into words, say “talk to a person” and a member of staff will help.")
        out.append(add_message(session, ctx, conversation, "assistant", text, summary=f"[asked] {question.en}"))
        session.commit()
        return conversation, out, None

    if source == "ai" and proposed.suspicious and not flags:
        flags = [*flags, "MODEL_SUSPICIOUS"]
        audit.append(session, user.id, "screening", {"flags": ["MODEL_SUSPICIOUS"]})
        locks.evaluate(session, user.id)
    plan = Plan(user_id=user.id, conversation_id=conversation.id, request=clean, lang=ctx.lang, source=source,
                model=versions.get("planner"), flags=flags,
                steps=[{"id": s.id, "action": s.action, "args": s.args, "after": s.after,
                        "run_at": s.run_at.model_dump() if hasattr(s.run_at, "model_dump") else s.run_at}
                       for s in proposed.steps])
    session.add(plan)
    session.flush()
    executor.prepare(ctx, plan)
    out.append(reply_for_plan(session, ctx, conversation, plan))
    session.commit()
    return conversation, out, plan

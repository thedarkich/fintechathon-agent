"""Credential changes. The new secret is typed only in the verification dialog, never in chat."""

from sqlalchemy import delete

from app.agent.core import Action, Args, Ctx, Refuse, register
from app.models import UserSession


def secret(ctx: Ctx, name: str) -> str:
    secrets = getattr(ctx.services, "secrets", None) or {}
    value = secrets.get(name)
    if not value:
        raise Refuse("SECRET_MISSING", "请在验证窗口中输入新的密码。", "Enter the new value in the verification window.")
    return value


def password_run(ctx: Ctx, r: dict) -> dict:
    from app.api.accounts import hash_password

    value = secret(ctx, "new_password")
    if not 10 <= len(value) <= 128:
        raise Refuse("WEAK_PASSWORD", "新密码需为 10–128 个字符。", "The new password needs 10–128 characters.")
    ctx.user.password_hash = hash_password(value)
    ctx.session.add(ctx.user)
    # sign out every other device
    current = getattr(ctx.services, "session_hash", None)
    statement = delete(UserSession).where(UserSession.user_id == ctx.user.id)
    if current:
        statement = statement.where(UserSession.token_hash != current)
    ctx.session.exec(statement)
    return {"changed": True}


def pin_run(ctx: Ctx, r: dict) -> dict:
    from app.api.accounts import hash_password

    value = secret(ctx, "new_pin")
    if not (len(value) == 6 and value.isdigit()) or len(set(value)) == 1 or value in "0123456789" or value in "9876543210":
        raise Refuse("WEAK_PIN", "交易密码需为 6 位数字，且不能是重复或连续数字。", "The PIN must be 6 digits, not repeated or sequential.")
    ctx.user.pin_hash = hash_password(value)
    ctx.session.add(ctx.user)
    return {"changed": True}


register(Action(
    name="password_change", args=Args, help="Change the login password (the new one is entered in the verification window).",
    resolve=lambda ctx, a: {"needs": "new_password"}, run=password_run,
    describe=lambda ctx, r: ctx.t("修改登录密码（其他设备将退出登录）", "Change the login password (other devices are signed out)"),
    reply=lambda ctx, r, res: ctx.t("登录密码已修改，其他设备已退出登录。", "Password changed; other devices were signed out."),
    rule="R_CREDENTIAL",
))

register(Action(
    name="pin_change", args=Args, help="Change the 6-digit transaction PIN (entered in the verification window).",
    resolve=lambda ctx, a: {"needs": "new_pin"}, run=pin_run,
    describe=lambda ctx, r: ctx.t("修改 6 位交易密码", "Change the 6-digit transaction PIN"),
    reply=lambda ctx, r, res: ctx.t("交易密码已修改。", "Transaction PIN changed."),
    rule="R_CREDENTIAL",
))

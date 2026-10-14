"""Who a phone number belongs to, for transfers by phone number (手机号转账).

In a real bank the number is looked up in the bank's own customer records and, for other banks, in the
interbank phone-payment directory. The sender sees only a masked name ("*小明") and the bank, enough to
notice a wrong number but not enough to learn a stranger's full name. This demo directory is made up:
the same number always gives the same person, and about one number in nine is not linked to any account.
"""

import hashlib
import re

from app.bank.transfers import OWN_BANK

SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈"
GIVEN = ["伟", "芳", "娜", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "秀英", "霞", "平",
         "刚", "桂英", "小明", "晓燕", "建华", "文博", "思远", "雨萱", "子涵", "浩然", "欣怡", "梓萱", "俊杰", "嘉怡", "宇轩", "佳琪"]
BANKS = [OWN_BANK, OWN_BANK, OWN_BANK, "招商银行", "中国工商银行", "中国建设银行", "中国农业银行", "中国银行", "交通银行"]
PHONE = re.compile(r"^1[3-9]\d{9}$")


def valid(phone: str) -> bool:
    return bool(PHONE.match(phone))


def mask_phone(phone: str) -> str:
    return phone[:3] + "****" + phone[-4:]


def mask_name(name: str) -> str:
    """The surname hidden, the rest shown: 王小明 → *小明, 李伟 → *伟, Li Ming → * Ming."""
    parts = name.split()
    if len(parts) > 1:  # written in Latin letters, surname first as in Chinese
        return "* " + " ".join(parts[1:])
    return "*" + name[1:]


def lookup(phone: str) -> dict | None:
    """The account holder behind a number, or None when the number is not linked to a bank account."""
    if not valid(phone):
        return None
    digest = int(hashlib.sha256(f"directory:{phone}".encode()).hexdigest(), 16)
    if digest % 9 == 0:
        return None
    name = SURNAMES[digest % len(SURNAMES)] + GIVEN[(digest // 97) % len(GIVEN)]
    bank = BANKS[(digest // 7919) % len(BANKS)]
    account = ("6230" if bank == OWN_BANK else "6217") + str(digest % 10**12).rjust(12, "0")
    return {"name": name, "masked": mask_name(name), "bank": bank, "account_no": account}

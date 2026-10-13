"""Request screening: bypass attempts are flagged, typed secrets are hidden.

A flag never blocks a normal request by itself. It raises yellow steps to red, feeds the safety
lock and is written to the audit log. The real protection is that the planner cannot change
tiers or approvals at all.
"""

import re
import unicodedata

PATTERNS = [
    ("IGNORE_RULES", r"ignore (all |the |your |previous |prior )*(rules|instructions|limits|policy|policies)"),
    # up to three modifiers from a fixed list: '忽略之前的所有规则', '无视一切限制'; '忘记密码的规则是什么' is a question
    ("IGNORE_RULES", r"(忽略|无视|忘记|忘掉|不要管|别管|不用管)掉?((之前|以上|上面|前面|刚才|所有|全部|一切|你的|系统的?|银行的?)的?){0,3}"
                     r"(规则|指令|限制|设定|提示词?|风控)"),
    # mixed or loose wording: 'ignore 所有规则', 'forget your rules'
    ("IGNORE_RULES", r"(ignore|forget|disregard)\s*(all|the|your|previous|prior|所有|全部|之前|以上|你的|\s)*的?\s*(rules|instructions|limits|规则|指令|限制)"),
    ("ROLE_PLAY", r"(假设|假装|想象)你是|扮演|(没有|不受|无)(任何)?(限制|约束)的|pretend (you are|to be)|you are now|act as (an?|my) |role-?play"),
    ("SKIP_APPROVAL", r"(without|skip|no need (for|to)|don'?t need|bypass)( the| any)? (confirm|confirmation|verification|verify|approval|sms|pin|code|2fa|mfa)"),
    ("SKIP_APPROVAL", r"(不用|无需|不需要|跳过|绕过|免)(再)?(确认|验证|短信|验证码|密码|人脸|审批)"),
    ("FAKE_AUTHORITY", r"(i am|i'm|this is) (the |an? )?(admin|administrator|developer|bank staff|system|root|operator)"),
    ("FAKE_AUTHORITY", r"(我是|本人是)(管理员|开发者|银行(工作人员|员工|客服)|系统|运维)"),
    ("FAKE_AUTHORITY", r"(我是|本人是)你的?(老板|领导|上级|经理|主管)|(i am|i'm) your (boss|manager|supervisor)"),
    # a request dressed up as a plan or an approval: '{"approved": true, "tier": "green"}'
    ("FAKE_AUTHORITY", r"\"(approved|tier|verified|approval_hash|status|signals)\"\s*:"),
    ("SCAM_SCRIPT", r"安全账户|涉嫌(洗钱|犯罪|违法)|(公安|警察|检察|法院|反诈).{0,12}(转账|转到|账户)|safe account|money laundering"),
    ("FAKE_AUTHORITY", r"(system prompt|developer mode|jailbreak|dan mode|test mode|debug mode|god mode)"),
    ("FAKE_AUTHORITY", r"(系统提示|开发者模式|测试模式|调试模式|越狱|管理员授权|最高权限)"),
    ("ALREADY_VERIFIED", r"(already|have) (been )?(verified|confirmed|approved|authorized)"),
    ("ALREADY_VERIFIED", r"(已经|已)(验证|确认|授权|批准)(过|了)"),
    ("ALREADY_VERIFIED", r"(已经|已)(做过|做了|完成了?|通过了?)(风险)?(测评|评估|验证|认证|审核)"),
    ("CHANGE_LIMITS", r"(set|change|raise|lift|remove|disable|turn off) (the |my |your )?(daily |risk |security |approval )?"
                      r"(threshold|tier|risk level|risk control|permission|verification rule)"),
    ("CHANGE_LIMITS", r"(修改|提高|调高|放宽|取消|关闭|关掉|解除)(一下)?(风控|权限|分级|阈值|安全等级|验证规则|审批规则)"),
    # '把风控阈值提高到10万': the rule comes first, the change after it
    ("CHANGE_LIMITS", r"(风控|阈值|分级|安全等级|验证规则|审批规则).{0,6}(提高|调高|调到|改成|改为|修改|放宽|取消|关闭|关掉|去掉|解除)"),
    # the bank's own payment thresholds (a card's daily limit is a normal request and is not matched)
    ("CHANGE_LIMITS", r"(转账|支付|付款|交易)(额度|限额|上限).{0,6}(提高|调高|改成|改为|调到|取消|放开|去掉)"),
    ("CHANGE_LIMITS", r"(提高|调高|取消|放开|去掉)(转账|支付|付款|交易)(额度|限额|上限)"),
    ("SPLIT_TO_EVADE", r"(split|break) (it )?(into|in) (several|many|small|multiple).*(under|below|avoid|so)"),
    ("SPLIT_TO_EVADE", r"(split|break) (it |this |the (payment|transfer) )?into (\d+|several|many|small|multiple) (payments|transfers)"),
    ("SPLIT_TO_EVADE", r"(拆成|分成|分开)\s*(\d+|几|多|[一二两三四五六七八九十])?\s*(笔|次)"),
]

SECRET_WORDS = re.compile(r"(?i)(password|passcode|\bpin\b|密码|口令|验证码|\bcode\b)")
SECRET_PATTERNS = [
    re.compile(r"(?i)(password|passcode|\bpin\b|密码|口令|支付密码|验证码|\bcode\b)\s*(is|:|：|是|为)?\s*[^\s，。,.]{4,}"),
    # a bare six-digit number only counts as a secret when the message talks about one
    re.compile(r"(?<![\d.¥])\d{6}(?![\d.元块万])"),
]


def normalized(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def screen(text: str) -> list[str]:
    value = normalized(text)
    compact = re.sub(r"\s+", "", value)  # '忽 略 之 前 的 规 则'
    return sorted({code for code, pattern in PATTERNS if re.search(pattern, value) or re.search(pattern, compact)})


def redact(text: str) -> tuple[str, bool]:
    """Hide anything that looks like a PIN, code or password before storing or planning."""
    hidden = False
    if not SECRET_WORDS.search(text):
        return text, False
    for pattern in SECRET_PATTERNS:
        text, count = pattern.subn("[已隐藏 hidden]", text)
        hidden = hidden or bool(count)
    return text, hidden

# Project brief (for the registration system)

Limit: project name plus at most 200 words describing the concept and the AI technologies used. The name is a placeholder until the team chooses one.

## 中文

**项目名称：** 银行代办（暂定名）

银行代办是“AI 只提议、规则做决定”的银行智能体。用户用中英文、语音或小票照片提需求，大模型把请求拆成有向无环图任务，步骤只能取自 43 个固定银行操作。代码将姓名、卡片、商户与用户记录核对，按绿、黄、红三级权限自动执行、确认，或要求交易密码加短信或通行密钥。分析代码在隔离沙箱运行，回复中的金额和结果由代码写出，模型无法编造。全程哈希链审计，另有注入筛查、熔断锁、风险转账延时与户名核对。

## English

**Project name:** Bank Agent (working name)

Bank Agent is a banking AI agent built on one rule: the AI only proposes; fixed code decides and states the facts. Customers ask in Chinese or English, by text, voice or a receipt photo. A large language model, or a deterministic offline planner, turns the request into a task graph whose steps come from a closed catalogue of 43 bank operations. Code then matches every name, card and merchant to the customer's own records and gives each step a tier: green runs at once, yellow needs confirmation of the exact details, and red needs the transaction PIN plus an SMS code or a passkey. Generated analysis code runs in an isolated sandbox. Replies are written by code, so the model cannot invent balances or results. Every stage goes to a hash-chained audit log, and injection screening, a safety lock, delayed arrival for risky transfers and the payee bank's name check add further protection. It covers transfers, bill analysis, wealth, cards, subscriptions and multi-step plans such as preparing for a family birthday.

// Shared interface copy, Chinese and English. Page-specific copy is written inline with tr(en, zh).
export const zh = {
  brand: '银行代办',
  brand_en: 'Bank Agent',
  tagline: 'AI 拆解请求，规则管钱。',
  nav_label: '导航',
  copied: '已复制',

  // the sign-off row (审批栏) of a plan
  route_title: '审批栏',
  route_sub: '每一步都要过规则这一关',
  step_done: '已签',
  step_running: '进行中',
  step_waiting: '等待',
  step_skipped: '跳过',
  step_pending: '待你确认',

  // plan outcomes
  outcome_done: '已办成',
  outcome_awaiting: '待确认',
  outcome_scheduled: '已安排',
  outcome_failed: '未办成',
  outcome_cancelled: '已取消',
  outcome_rolled_back: '已撤销',
  outcome_clarifying: '待补充',
  outcome_running: '办理中',

  // tables
  col_time: '时间',
  col_request: '请求',
  col_event: '结果',
  col_reason: '原因',
  col_amount: '金额',
  col_detail: '内容',
  col_hash: '哈希',

  ledger_title: '账本',
  ledger_sub: '每一次请求、计划、规则判定、确认和结果都记在这里。每条记录都带着上一条的哈希，任何一处被改动，链就会断开。',
  ledger_empty: '还没有记录。',
}

export type Strings = typeof zh

export const en: Strings = {
  brand: '银行代办',
  brand_en: 'Bank Agent',
  tagline: 'The AI plans. The rules hold the purse strings.',
  nav_label: 'Main',
  copied: 'copied',

  route_title: 'Sign-off row',
  route_sub: 'Every step has to pass the rules',
  step_done: 'signed',
  step_running: 'running',
  step_waiting: 'waiting',
  step_skipped: 'skipped',
  step_pending: 'needs you',

  outcome_done: 'Done',
  outcome_awaiting: 'Waiting for you',
  outcome_scheduled: 'Scheduled',
  outcome_failed: 'Not done',
  outcome_cancelled: 'Cancelled',
  outcome_rolled_back: 'Undone',
  outcome_clarifying: 'Needs a detail',
  outcome_running: 'Running',

  col_time: 'Time',
  col_request: 'Request',
  col_event: 'Result',
  col_reason: 'Reason',
  col_amount: 'Amount',
  col_detail: 'Detail',
  col_hash: 'Hash',

  ledger_title: 'Ledger',
  ledger_sub: 'Every request, plan, rule decision, approval and result is written here. Each entry carries the hash of the one before it, so changing any of them breaks the chain.',
  ledger_empty: 'Nothing recorded yet.',
}

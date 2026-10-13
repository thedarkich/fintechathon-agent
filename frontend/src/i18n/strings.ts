// Shared interface copy, Chinese and English. Page-specific copy is written inline with tr(en, zh).
export const zh = {
  brand: '银行代办',
  brand_en: 'Bank Agent',
  tagline: '你说一句，我来办；动钱之前，先问你。',

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
  col_event: '结果',
  col_detail: '内容',
  col_hash: '哈希',

  ledger_title: '记录',
  ledger_sub: '你办过的每件事，以及背后每一步的记录。记录用哈希串起来，任何改动都会被发现。',
  ledger_empty: '还没有记录。',
}

export type Strings = typeof zh

export const en: Strings = {
  brand: '银行代办',
  brand_en: 'Bank Agent',
  tagline: 'Say it once. We do it. Money only moves when you say yes.',

  outcome_done: 'Done',
  outcome_awaiting: 'Waiting for you',
  outcome_scheduled: 'Scheduled',
  outcome_failed: 'Not done',
  outcome_cancelled: 'Cancelled',
  outcome_rolled_back: 'Undone',
  outcome_clarifying: 'Needs a detail',
  outcome_running: 'Running',

  col_time: 'Time',
  col_event: 'Result',
  col_detail: 'Detail',
  col_hash: 'Hash',

  ledger_title: 'History',
  ledger_sub: 'Everything you asked for, and the record of every step behind it. Entries are chained by hashes, so any change would be noticed.',
  ledger_empty: 'Nothing recorded yet.',
}

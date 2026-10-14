/** Short names for the bank actions, shown where a plan lists its steps. */
const ACTION: Record<string, [string, string]> = {
  // action: [zh label, en label]
  balance: ['查余额', 'Balance'], transactions: ['查交易', 'Transactions'], spending: ['算消费', 'Spending'],
  report: ['出报告', 'Report'], anomalies: ['查异常', 'Anomalies'], analyze: ['沙箱分析', 'Sandbox'],
  payees: ['收款人', 'Payees'], cards: ['查卡片', 'Cards'], scheduled: ['查预约', 'Scheduled'],
  collections: ['查 AA', 'Split bills'], reserves: ['查预留', 'Reserves'], notifications: ['查提醒', 'Reminders'],
  contact_lookup: ['查联系人', 'Contact'], read_receipt: ['读小票', 'Receipt'], handoff: ['转人工', 'Handover'],
  transfer: ['转账', 'Transfer'], phone_transfer: ['手机号转账', 'Transfer by phone'], bill_pay: ['缴费', 'Pay a bill'], bill_autopay: ['自动缴费', 'Automatic payment'], qr_pay: ['扫码付', 'QR pay'], transfer_cancel: ['撤销转账', 'Cancel transfer'], scheduled_cancel: ['停预约', 'Stop schedule'], plan_cancel: ['停计划', 'Stop plan'], schedule_transfer: ['预约转账', 'Schedule'], merchant_order: ['下单', 'Order'],
  collect: ['AA 收款', 'Split bill'], payee_add: ['加收款人', 'Add payee'], reserve_create: ['预留资金', 'Set aside'],
  reserve_release: ['释放预留', 'Release'], card_apply: ['申请卡片', 'New card'], card_freeze: ['冻结卡片', 'Freeze'],
  card_unfreeze: ['解冻卡片', 'Unfreeze'], card_restrict: ['卡片开关', 'Card switches'], card_limit: ['调整限额', 'Card limit'],
  card_report_lost: ['挂失', 'Report lost'], subscriptions: ['查订阅', 'Subscriptions'], subscription_cancel: ['取消订阅', 'Cancel sub.'],
  subscription_remind: ['续费提醒', 'Reminder'], wealth_holdings: ['查持仓', 'Holdings'], wealth_products: ['查产品', 'Products'],
  wealth_compare: ['比产品', 'Compare'], wealth_recommend: ['荐产品', 'Recommend'], wealth_subscribe: ['申购', 'Buy'],
  wealth_redeem: ['赎回', 'Redeem'], risk_assessment: ['风险测评', 'Risk profile'], password_change: ['改登录密码', 'Password'],
  pin_change: ['改交易密码', 'PIN'],
}

export const actionLabel = (action: string, lang: 'zh' | 'en') => ACTION[action]?.[lang === 'zh' ? 0 : 1] ?? action

import type { PlanStep } from '../api/types'
import { useLang } from '../i18n'
import { TierTag } from './bits'

const ACTION: Record<string, [string, string, string]> = {
  // action: [zh label, en label, stamp character]
  balance: ['查余额', 'Balance', '查'], transactions: ['查交易', 'Transactions', '查'], spending: ['算消费', 'Spending', '算'],
  report: ['出报告', 'Report', '报'], anomalies: ['查异常', 'Anomalies', '查'], analyze: ['沙箱分析', 'Sandbox', '析'],
  payees: ['收款人', 'Payees', '查'], cards: ['查卡片', 'Cards', '查'], scheduled: ['查预约', 'Scheduled', '查'],
  collections: ['查 AA', 'Split bills', '查'], reserves: ['查预留', 'Reserves', '查'], notifications: ['查提醒', 'Reminders', '查'],
  contact_lookup: ['查联系人', 'Contact', '查'], read_receipt: ['读小票', 'Receipt', '票'], handoff: ['转人工', 'Handover', '人'],
  transfer: ['转账', 'Transfer', '转'], schedule_transfer: ['预约转账', 'Schedule', '约'], merchant_order: ['下单', 'Order', '购'],
  collect: ['AA 收款', 'Split bill', '收'], payee_add: ['加收款人', 'Add payee', '加'], reserve_create: ['预留资金', 'Set aside', '留'],
  reserve_release: ['释放预留', 'Release', '还'], card_apply: ['申请卡片', 'New card', '申'], card_freeze: ['冻结卡片', 'Freeze', '冻'],
  card_unfreeze: ['解冻卡片', 'Unfreeze', '解'], card_restrict: ['卡片开关', 'Card switches', '限'], card_limit: ['调整限额', 'Card limit', '额'],
  card_report_lost: ['挂失', 'Report lost', '挂'], subscriptions: ['查订阅', 'Subscriptions', '订'], subscription_cancel: ['取消订阅', 'Cancel sub.', '退'],
  subscription_remind: ['续费提醒', 'Reminder', '醒'], wealth_holdings: ['查持仓', 'Holdings', '查'], wealth_products: ['查产品', 'Products', '查'],
  wealth_compare: ['比产品', 'Compare', '比'], wealth_recommend: ['荐产品', 'Recommend', '荐'], wealth_subscribe: ['申购', 'Buy', '投'],
  wealth_redeem: ['赎回', 'Redeem', '赎'], risk_assessment: ['风险测评', 'Risk profile', '测'], password_change: ['改登录密码', 'Password', '密'],
  pin_change: ['改交易密码', 'PIN', '密'],
}

export const actionLabel = (action: string, lang: 'zh' | 'en') => ACTION[action]?.[lang === 'zh' ? 0 : 1] ?? action
const stampChar = (action: string) => ACTION[action]?.[2] ?? '办'

/**
 * The sign-off row (审批栏): every step of the plan is a box on the form,
 * and each box gets its own small seal when that step is signed off and done.
 */
export function StepRow({ steps, title = true }: { steps: PlanStep[]; title?: boolean }) {
  const { t, lang, tr } = useLang()
  return (
    <div>
      {title && (
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="cond whitespace-nowrap text-lg font-bold">{t.route_title}</span>
          <span className="text-sm text-ink2">{t.route_sub}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <ol className="ruled grid overflow-hidden bg-field" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(5.6rem, 1fr))`, minWidth: `${steps.length * 5.6}rem` }} aria-label={t.route_title}>
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1
            const label = actionLabel(s.action, lang)
            return (
              <li key={s.id} className={`flex min-h-[7rem] flex-col ${isLast ? '' : 'border-r border-rule'}`}>
                <span className="rule-b flex h-7 items-center justify-center whitespace-nowrap px-1 text-center text-[0.8rem] leading-none text-ink2">{label}</span>
                <span className="relative flex flex-1 items-center justify-center px-1" aria-live="polite">
                  {s.status === 'done' && (
                    <span
                      className="seal-stamp inline-flex h-9 w-9 items-center justify-center rounded-[2px] text-[1.05rem] font-bold"
                      style={{ border: '2px solid var(--cinnabar)', color: 'var(--cinnabar)', ['--seal-rot' as string]: `${(i % 2 ? 6 : -7)}deg` }}
                      aria-label={`${label}: ${t.step_done}`}
                    >
                      {stampChar(s.action)}
                    </span>
                  )}
                  {s.status === 'compensated' && (
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-[2px] text-[1.05rem] font-bold" style={{ border: '2px solid var(--ink-2)', color: 'var(--ink-2)', transform: 'rotate(-4deg)' }} aria-label={`${label}: ${tr('undone', '已撤销')}`}>
                      撤
                    </span>
                  )}
                  {s.status === 'running' && <span className="step-live h-9 w-9 rounded-[2px] border-2 border-dashed border-ink2" aria-label={`${label}: ${t.step_running}`} />}
                  {s.status === 'pending' && (
                    <span className="flex flex-col items-center gap-1 text-center text-[0.72rem] leading-tight text-ink2">
                      <span className="h-9 w-9 rounded-[2px] border-2 border-dashed" style={{ borderColor: s.tier === 'red' ? 'var(--cinnabar)' : 'var(--ink-2)' }} aria-hidden />
                      {t.step_pending}
                    </span>
                  )}
                  {s.status === 'waiting' && (
                    <span className="flex flex-col items-center gap-1 text-center text-[0.72rem] leading-tight text-ink2">
                      <span className="step-live h-9 w-9 rounded-[2px] border-2 border-dashed border-ink2" aria-hidden />
                      {s.run_at ? s.run_at.slice(5, 10) : t.step_waiting}
                    </span>
                  )}
                  {(s.status === 'skipped' || s.status === 'cancelled' || s.status === 'new') && (
                    <span className="text-center text-[0.75rem] leading-tight text-ink2">
                      <svg width="42" height="22" aria-hidden className="mx-auto block">
                        <line x1="2" y1="20" x2="40" y2="2" stroke="var(--rule)" strokeWidth="1.5" />
                      </svg>
                      {s.status === 'cancelled' ? tr('cancelled', '已取消') : t.step_skipped}
                    </span>
                  )}
                  {s.status === 'failed' && <span className="text-xl font-bold text-ink" aria-label={`${label}: ${tr('failed', '未完成')}`}>✕</span>}
                </span>
                <span className="flex h-7 items-center justify-center border-t border-rule px-1"><TierTag tier={s.tier} /></span>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

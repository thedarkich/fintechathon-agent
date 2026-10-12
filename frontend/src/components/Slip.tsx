import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Clock } from 'lucide-react'
import { useLang } from '../i18n'
import { call, errorText, type Plan, type PlanResult } from '../lib/api'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { TierChip } from './Chrome'
import { VerifySheet } from './Verify'

const ACTION_LABEL: Record<string, [string, string]> = {
  transfer: ['转账', 'Transfer'], schedule_transfer: ['预约转账', 'Scheduled transfer'], merchant_order: ['订购', 'Order'],
  collect: ['AA 收款', 'Split bill'], payee_add: ['新增收款人', 'New payee'], reserve_create: ['预留资金', 'Set money aside'],
  reserve_release: ['释放预留', 'Release reserve'], card_apply: ['申请卡片', 'New card'], card_freeze: ['冻结卡片', 'Freeze card'],
  card_unfreeze: ['解冻卡片', 'Unfreeze card'], card_restrict: ['卡片开关', 'Card settings'], card_limit: ['调整限额', 'Card limit'],
  card_report_lost: ['挂失', 'Report lost'], subscriptions: ['查看订阅', 'Subscriptions'], subscription_cancel: ['取消订阅', 'Cancel subscription'],
  subscription_remind: ['续费提醒', 'Renewal reminder'], wealth_subscribe: ['申购理财', 'Buy investment'], wealth_redeem: ['赎回理财', 'Redeem investment'],
  risk_assessment: ['风险测评', 'Risk profile'], password_change: ['修改登录密码', 'Change password'], pin_change: ['修改交易密码', 'Change PIN'],
  contact_lookup: ['查找联系人', 'Look up contact'], analyze: ['沙箱分析', 'Sandbox analysis'],
}

export const actionLabel = (action: string, lang: 'zh' | 'en') => ACTION_LABEL[action]?.[lang === 'zh' ? 0 : 1] ?? action

const STATUS: Record<string, [string, string]> = {
  awaiting_approval: ['待确认', 'Waiting for you'], running: ['执行中', 'Running'], scheduled: ['已安排', 'Scheduled'],
  done: ['已完成', 'Done'], failed: ['未完成', "Didn't complete"], cancelled: ['已取消', 'Cancelled'], rolled_back: ['已撤销', 'Undone'],
  clarifying: ['待补充', 'Needs a detail'],
}

export function usePlan(planId: string | null, initial?: Plan) {
  const { lang } = useLang()
  return useQuery({
    queryKey: ['plan', planId, lang],
    queryFn: () => call<Plan>(`/api/plans/${planId}?lang=${lang}`),
    enabled: !!planId,
    initialData: initial,
    refetchInterval: (query) => (query.state.data?.status === 'scheduled' ? 15_000 : false),
  })
}

export function Slip({ planId }: { planId: string }) {
  const { tr, lang } = useLang()
  const { apply } = useChat()
  const plan = usePlan(planId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const data = plan.data
  if (!data) return <div className="slip h-24 animate-pulse" />
  const waiting = data.status === 'awaiting_approval'
  const shown = data.steps.filter((s) => s.tier && s.tier !== 'green' && ['pending', 'done', 'waiting', 'failed', 'cancelled', 'skipped', 'compensated'].includes(s.status))
  // the headline amount is money leaving the customer's accounts; reserves and split-bill requests are not
  const money = shown.filter((s) => s.fen && ['transfer', 'schedule_transfer', 'merchant_order', 'wealth_subscribe'].includes(s.action))
  const total = money.reduce((sum, s) => sum + (s.fen ?? 0), 0)

  async function act(path: string, body: object) {
    setBusy(true)
    setError('')
    try {
      apply(await call<PlanResult>(`/api/plans/${planId}/${path}`, { ...body, lang }))
    } catch (err) {
      setError(errorText(err, lang))
      void plan.refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`slip tier-${data.tier} ${waiting ? '' : 'settle'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink2">
          {shown.length === 1 ? actionLabel(shown[0].action, lang) : tr(`${shown.length} steps for your approval`, `${shown.length} 项操作待确认`)}
        </span>
        {waiting ? <TierChip tier={data.tier} /> : <span className="text-xs font-semibold text-ink2">{(STATUS[data.status] ?? [data.status, data.status])[lang === 'zh' ? 0 : 1]}</span>}
      </div>
      {total > 0 && <p className="num mt-1 text-[28px] font-bold leading-tight tracking-tight">{yuan(total)}</p>}
      <ol className="mt-2 space-y-2.5">
        {shown.map((step, index) => (
          <li key={step.id} className="text-sm">
            <div className="flex gap-2">
              {shown.length > 1 && <span className="num mt-px text-xs font-bold text-ink3">{index + 1}</span>}
              <div className="min-w-0 flex-1">
                <p className={`keep ${['cancelled', 'skipped', 'compensated'].includes(step.status) ? 'text-ink3 line-through' : ''}`}>{step.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink3">
                  {shown.length > 1 && <TierChip tier={step.tier} />}
                  {step.run_at && <span className="inline-flex items-center gap-1"><Clock size={12} />{step.run_at.slice(0, 16).replace('T', ' ')}</span>}
                  {step.rule_text && <span>{step.rule_text}</span>}
                </div>
                {step.signals.map((signal) => (
                  <p key={signal} className="mt-1 inline-flex items-start gap-1 text-xs font-semibold text-vermilion"><AlertTriangle size={13} className="mt-px shrink-0" />{signal}</p>
                ))}
                {step.error && <p className="mt-1 text-xs text-vermilion">{step.error}</p>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-3 rounded-lg bg-vermilion-wash px-3 py-2 text-sm text-vermilion">{error}</p>}
      {waiting && (
        <div className="slip-perf flex flex-wrap items-center justify-end gap-2">
          <button className="btn btn-quiet" disabled={busy} onClick={() => act('cancel', { rollback: false })}>{tr('Cancel', '取消')}</button>
          {data.tier === 'red'
            ? <button className="btn btn-primary" disabled={busy} onClick={() => setVerifying(true)}>{tr('Verify and run', '验证并执行')}</button>
            : <button className="btn btn-primary" disabled={busy} onClick={() => act('approve', { approval_hash: data.approval_hash })}>{tr('Confirm', '确认执行')}</button>}
        </div>
      )}
      {data.status === 'scheduled' && (
        <div className="slip-perf flex justify-end">
          <button className="btn btn-quiet" disabled={busy} onClick={() => act('cancel', { rollback: true })}>{tr('Stop and undo', '停止并撤销')}</button>
        </div>
      )}
      {verifying && <VerifySheet plan={data} onClose={() => setVerifying(false)} />}
    </div>
  )
}

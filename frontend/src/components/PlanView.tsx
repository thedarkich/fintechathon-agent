import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, errorText } from '../api/client'
import type { Plan, PlanRow, PlanStatus } from '../api/types'
import { useLang } from '../i18n'
import type { Strings } from '../i18n/strings'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { Decision } from './Decision'
import { Seal, type MarkKind, type SealKind } from './Seal'
import { StepRow } from './StepRow'
import { VerifyDialog } from './Verify'

export function usePlan(planId: string | null) {
  const { lang } = useLang()
  return useQuery({
    queryKey: ['plan', planId, lang],
    queryFn: () => api.plan(planId!, lang),
    enabled: !!planId,
    refetchInterval: (query) => (query.state.data?.status === 'scheduled' ? 10_000 : false),
  })
}

const blockedBy = (p: { steps: { error_code?: string | null }[] } | Plan) =>
  p.steps.some((s) => 'error_code' in s && (s.error_code === 'LOCKED' || s.error_code === 'CODE_REJECTED'))

export function sealFor(p: Plan): SealKind | null {
  switch (p.status) {
    case 'done': return 'done'
    case 'scheduled': return 'scheduled'
    case 'cancelled': return 'cancelled'
    case 'rolled_back': return 'undone'
    case 'failed': return blockedBy(p) ? 'blocked' : 'refused'
    default: return null
  }
}

export function markFor(p: Pick<PlanRow, 'status' | 'tier' | 'reason'>): MarkKind {
  switch (p.status) {
    case 'done': return p.tier === 'green' ? 'query' : 'done'
    case 'awaiting_approval':
    case 'clarifying':
    case 'running': return 'pending'
    case 'scheduled': return 'scheduled'
    case 'cancelled': return 'cancelled'
    case 'rolled_back': return 'undone'
    case 'failed': return p.reason && /锁|lock|安全检查|safety check/i.test(p.reason) ? 'blocked' : 'refused'
    default: return 'error'
  }
}

export function statusLabel(status: PlanStatus, t: Strings): string {
  return {
    done: t.outcome_done, awaiting_approval: t.outcome_awaiting, scheduled: t.outcome_scheduled, failed: t.outcome_failed,
    cancelled: t.outcome_cancelled, rolled_back: t.outcome_rolled_back, clarifying: t.outcome_clarifying, running: t.outcome_running,
  }[status]
}

export const markColor = (kind: MarkKind) =>
  kind === 'done' || kind === 'query' ? 'var(--jade)' : kind === 'blocked' || kind === 'flag' ? 'var(--cinnabar)' : kind === 'pending' || kind === 'cancelled' || kind === 'undone' ? 'var(--ink-2)' : 'var(--ink)'

/** The plan as an approval slip: the step row, who decided what, and the customer's own decision at the bottom. */
export function PlanView({ planId, hasPasskey, compact = false }: { planId: string; hasPasskey: boolean; compact?: boolean }) {
  const { tr, lang, t } = useLang()
  const { apply } = useChat()
  const plan = usePlan(planId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const p = plan.data
  if (!p) return <div className="h-48 animate-pulse rounded-box bg-paper2" aria-hidden />
  const money = p.steps.filter((s) => s.fen && ['transfer', 'schedule_transfer', 'merchant_order', 'wealth_subscribe'].includes(s.action))
  const total = money.reduce((sum, s) => sum + (s.fen ?? 0), 0)
  const seal = sealFor(p)

  async function act(task: () => Promise<Parameters<typeof apply>[0]>) {
    setBusy(true)
    setError('')
    try {
      apply(await task())
    } catch (err) {
      setError(errorText(err, lang))
      void plan.refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepRow steps={p.steps} title={!compact} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {seal ? <Seal kind={seal} size={compact ? 84 : 104} /> : null}
        <div className="min-w-0">
          <p className="cond text-2xl font-bold leading-tight" style={{ color: seal === 'done' ? 'var(--jade)' : seal === 'blocked' ? 'var(--cinnabar)' : 'var(--ink)' }}>
            {statusLabel(p.status, t)}
          </p>
          {total > 0 && <p className="num font-mono text-[1.05rem]">{yuan(total)}</p>}
          <p className="text-sm text-ink2">“{p.request}”</p>
        </div>
      </div>
      <Decision plan={p}>
        {p.status === 'awaiting_approval' ? (
          <>
            <p className="mt-1.5 font-semibold leading-snug">
              {p.tier === 'red'
                ? tr('High risk: confirm with your PIN and an SMS code or passkey.', '高风险：需要交易密码加短信验证码或通行密钥。')
                : tr('Check the steps above, then confirm.', '核对上面的步骤后确认。')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {p.tier === 'red'
                ? <button type="button" className="btn btn-ink py-1.5" disabled={busy} onClick={() => setVerifying(true)}>{tr('Verify and run', '验证并执行')}</button>
                : <button type="button" className="btn btn-ink py-1.5" disabled={busy} onClick={() => void act(() => api.approve(p.id, p.approval_hash!, lang))}>{tr('Confirm and run', '确认执行')}</button>}
              <button type="button" className="btn btn-line py-1.5" disabled={busy} onClick={() => void act(() => api.cancel(p.id, false, lang))}>{tr('Cancel', '取消')}</button>
            </div>
          </>
        ) : p.status === 'scheduled' ? (
          <>
            <p className="mt-1.5 leading-snug">{tr('Approved. The remaining steps run at their time and are checked against the rules again first.', '已确认。剩余步骤会按时执行，执行前会再次核对规则。')}</p>
            <button type="button" className="btn btn-cinnabar mt-3 py-1.5" disabled={busy} onClick={() => void act(() => api.cancel(p.id, true, lang))}>{tr('Stop and undo', '停止并撤销')}</button>
          </>
        ) : p.status === 'clarifying' ? (
          <p className="mt-1.5 leading-snug text-ink2">{tr('The assistant needs one more detail. Answer in the conversation.', '助手还需要一个信息，请在对话中回答。')}</p>
        ) : (
          <p className="mt-1.5 leading-snug text-ink2">
            {p.status === 'done' ? tr('Nothing left to decide. Every step is in the ledger.', '没有需要你决定的了，每一步都记在账本里。')
              : p.status === 'failed' ? tr('Stopped before anything unsafe happened. Steps that had already run are listed above.', '在出现不安全的情况前已停止。已经执行的步骤见上方。')
                : tr('Stopped. The remaining steps will not run.', '已停止，剩余步骤不会执行。')}
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-cinnabar">{error}</p>}
      </Decision>
      {verifying && <VerifyDialog plan={p} hasPasskey={hasPasskey} onClose={() => setVerifying(false)} />}
    </div>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, errorText } from '../api/client'
import type { Plan, PlanRow, PlanStatus, PlanStep } from '../api/types'
import { useLang } from '../i18n'
import type { Strings } from '../i18n/strings'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { TierTag } from './bits'
import { Decision } from './Decision'
import { Seal, type MarkKind, type SealKind } from './Seal'
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

const MONEY = ['transfer', 'phone_transfer', 'schedule_transfer', 'merchant_order', 'wealth_subscribe']

/** One step's state as a small symbol: done, waiting for you, scheduled, failed or not run. */
function StepIcon({ s }: { s: PlanStep }) {
  const { tr } = useLang()
  const map: Record<string, [string, string, string]> = {
    done: ['✓', 'var(--jade)', tr('done', '已完成')], waiting: ['◷', 'var(--ink-2)', tr('scheduled', '已安排')],
    failed: ['✕', 'var(--cinnabar)', tr('not done', '未完成')], compensated: ['↺', 'var(--ink-2)', tr('undone', '已撤销')],
    cancelled: ['–', 'var(--ink-2)', tr('cancelled', '已取消')], skipped: ['–', 'var(--ink-2)', tr('skipped', '未执行')],
  }
  const [glyph, color, label] = map[s.status] ?? ['○', 'var(--ink-2)', tr('waiting for you', '等你确认')]
  return <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-bold" style={{ color, borderColor: color }} title={label} aria-label={label}>{glyph}</span>
}

function title(p: Plan, tr: (en: string, zh: string) => string) {
  switch (p.status) {
    case 'awaiting_approval': return p.tier === 'red' ? tr('Verify it’s you to continue', '请验证身份后确认') : tr('Please confirm', '请确认')
    case 'clarifying': return tr('One more detail needed', '还需要一个信息')
    case 'running': return tr('In progress…', '正在办理…')
    case 'done': return tr('Done', '已办好')
    case 'scheduled': return tr('Scheduled', '已安排')
    case 'failed': return tr('Not done', '没有办成')
    case 'cancelled': return tr('Cancelled', '已取消')
    case 'rolled_back': return tr('Undone', '已撤销')
  }
}

/**
 * The confirmation card: what will happen in plain label–value rows, why it needs a yes, and the buttons.
 * How the request was checked (AI, rules, you) is one tap away rather than always on screen.
 */
export function ConfirmCard({ planId, showRequest = false }: { planId: string; showRequest?: boolean }) {
  const { tr, lang } = useLang()
  const { apply } = useChat()
  const overview = useOverview()
  const plan = usePlan(planId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const p = plan.data
  if (!p) return <div className="h-40 animate-pulse rounded-box bg-paper2" aria-hidden />
  const total = p.steps.filter((s) => s.fen && MONEY.includes(s.action)).reduce((sum, s) => sum + (s.fen ?? 0), 0)
  const single = p.steps.length === 1 ? p.steps[0] : null
  const waiting = p.status === 'awaiting_approval'
  const pending = p.steps.filter((s) => s.status === 'pending')
  const deciding = pending.find((s) => s.tier === p.tier) ?? pending[0]
  const signals = [...new Set(pending.flatMap((s) => s.signals))]
  // the reason the card gives: a risk signal that raised the tier, and the step's own rule only when it alone sets this tier
  // ('today's payments stay under ¥1,000' is no reason to ask for a PIN)
  const ruleSetsTier = !!deciding?.rule && { G: 'green', Y: 'yellow', R: 'red' }[deciding.rule[0]] === p.tier
  const reasons = [...(ruleSetsTier || !signals.length ? [deciding?.rule_text ?? ''] : []), ...signals].filter(Boolean)
  const failed = p.steps.find((s) => s.error)
  const seal = sealFor(p)
  const accent = waiting ? (p.tier === 'red' ? 'var(--cinnabar)' : 'var(--ink)') : p.status === 'done' || p.status === 'scheduled' ? 'var(--jade)' : 'var(--rule-strong)'

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
    <div className="confirm-card overflow-hidden rounded-[20px] bg-[var(--field)]" style={{ borderTop: `4px solid ${accent}` }}>
      <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <p className="text-[1.05rem] font-bold leading-tight">{title(p, tr)}</p>
          {showRequest && <p className="mt-0.5 truncate text-sm text-ink2" title={p.request}>“{p.request}”</p>}
        </div>
        {waiting ? <TierTag tier={p.tier} /> : seal === 'done' || seal === 'scheduled' ? <Seal kind={seal} size={58} /> : null}
      </div>

      <div className="px-4 pb-3">
        {single && single.details.length > 0 ? (
          <dl className="divide-y divide-[var(--rule)] border-y border-rule">
            {single.details.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between gap-4 py-2 text-[0.93rem]">
                <dt className="shrink-0 text-ink2">{d.label}</dt>
                <dd className={`min-w-0 text-right ${d.value === yuan(single.fen ?? -1) ? 'num font-mono text-lg font-bold' : 'font-semibold'}`}>{d.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <ol className="space-y-2 border-y border-rule py-2.5">
            {p.steps.map((s) => (
              <li key={s.id} className="flex gap-2.5 text-[0.93rem] leading-snug">
                <StepIcon s={s} />
                <span className={`min-w-0 flex-1 ${s.status === 'cancelled' || s.status === 'skipped' ? 'text-ink2 line-through' : ''}`}>
                  {s.text}
                  {s.status === 'waiting' && s.run_at && <span className="block text-xs text-ink2">{tr(`runs ${stamp(s.run_at)}, after the rules check it again`, `${stamp(s.run_at)} 执行，执行前会再检查一次`)}</span>}
                </span>
              </li>
            ))}
            {total > 0 && p.steps.length > 1 && <li className="flex justify-between pt-1 text-sm"><span className="text-ink2">{tr('Total', '合计')}</span><span className="num font-mono font-bold">{yuan(total)}</span></li>}
          </ol>
        )}

        {waiting && deciding?.rule_text && (
          <p className="mt-2.5 text-sm leading-snug text-ink2">
            {p.tier === 'red' ? tr('You’ll need your PIN and an SMS code, or a passkey. Why: ', '需要交易密码和短信验证码，或通行密钥。原因：') : tr('Why: ', '原因：')}
            <span className={signals.length ? 'font-semibold text-cinnabar' : ''}>{reasons.join(lang === 'zh' ? '；' : '; ')}</span>{lang === 'zh' ? '。' : '.'}
          </p>
        )}
        {p.status === 'failed' && failed?.error && <p className="mt-2.5 text-sm leading-snug text-cinnabar">{failed.error}</p>}
        {p.status === 'scheduled' && <p className="mt-2.5 text-sm leading-snug text-ink2">{tr('The rest runs at its time, after the rules check it again. You can still stop it.', '剩下的步骤会按时执行，执行前会再检查一次，现在仍可停止。')}</p>}
        {p.status === 'clarifying' && <p className="mt-2.5 text-sm leading-snug text-ink2">{tr('Answer the question above to continue.', '回答上面的问题即可继续。')}</p>}

        {waiting && (
          <div className="mt-3 flex flex-wrap gap-2">
            {p.tier === 'red'
              ? <button type="button" className="btn border-cinnabar bg-cinnabar px-5 py-2 text-white hover:brightness-110" disabled={busy} onClick={() => setVerifying(true)}>{tr('Verify and confirm', '验证并确认')}</button>
              : <button type="button" className="btn btn-ink px-6 py-2" disabled={busy} onClick={() => void act(() => api.approve(p.id, p.approval_hash!, lang))}>{tr('Confirm', '确认')}</button>}
            <button type="button" className="btn btn-line px-5 py-2" disabled={busy} onClick={() => void act(() => api.cancel(p.id, false, lang))}>{tr('Cancel', '取消')}</button>
          </div>
        )}
        {p.status === 'scheduled' && <button type="button" className="btn btn-line mt-3 py-1.5" disabled={busy} onClick={() => void act(() => api.cancel(p.id, true, lang))}>{tr('Stop and undo', '停止并撤销')}</button>}
        {p.status === 'done' && p.steps.some((s) => s.action === 'transfer' || s.action === 'phone_transfer') && (
          <Link to="/accounts?tab=transfers" className="mt-2.5 inline-block text-sm font-semibold text-[var(--action)]">{tr('See where the money is →', '查看到账进度 →')}</Link>
        )}
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-cinnabar">{error}</p>}

        <details className="mt-3 rounded-box bg-paper px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-ink2">{waiting ? tr('Why do I need to confirm?', '为什么要确认？') : tr('How this was checked', '是怎么检查的？')}</summary>
          <div className="mt-2"><Decision plan={p} /></div>
        </details>
      </div>
      {verifying && <VerifyDialog plan={p} hasPasskey={!!overview.data?.has_passkey} onClose={() => setVerifying(false)} />}
    </div>
  )
}

/** Kept for older call sites: the plan is shown as its confirmation card. */
export const PlanView = ConfirmCard

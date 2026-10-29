import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Sparkles } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { Plan, PlanRow, PlanStatus, PlanStep } from '../api/types'
import { useLang } from '../i18n'
import type { Strings } from '../i18n/strings'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { Notice, TierTag } from './bits'
import { ShopPicker } from './Places'
import { Decision } from './Decision'
import { Seal, type MarkKind, type SealKind } from './Seal'
import { VerifyDialog } from './Verify'

export function usePlan(planId: string | null) {
  const { lang } = useLang()
  return useQuery({
    queryKey: ['plan', planId, lang],
    queryFn: () => api.plan(planId!, lang),
    enabled: !!planId,
    // switching language keeps showing the same plan until its other-language text arrives: no flash to a skeleton,
    // and an open verification dialog stays open with what was typed
    placeholderData: (previous, query) => (query?.queryKey[1] === planId ? previous : undefined),
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
// slip rows that warn: a name that doesn't match the account, and the warning that comes with a payment's purpose
const ALARM = /^(不一致|Doesn't match)/
const ALARM_LABEL = /^(风险提示|Warning)$/
const NAME_LABEL = /^(户名核验|Name check)$/
// account numbers: checked less often, so they fold under "More details"
const MORE_LABEL = /^(收款账户|付款账户|Account|From)$/
const PAYEE_LABEL = /^(收款人|To)$/

/** A step's own warnings: a name that doesn't match its account, and the warning for what the payment is for. */
function alarmsOf(s: PlanStep) {
  const rows = s.details ?? []
  return {
    mismatch: rows.find((d) => NAME_LABEL.test(d.label) && ALARM.test(d.value)),
    warning: rows.find((d) => ALARM_LABEL.test(d.label)),
    scam: s.signal_codes.includes('S_SCAM_PURPOSE'),
  }
}

/** One step's state as a small symbol: done, waiting for you, scheduled, failed or not run. */
function StepIcon({ s }: { s: PlanStep }) {
  const { tr } = useLang()
  const map: Record<string, [string, string, string]> = {
    done: ['✓', 'var(--jade)', tr('done', '已完成')], waiting: ['◷', 'var(--ink-2)', tr('scheduled', '已安排')],
    failed: ['✕', 'var(--cinnabar)', tr('not done', '未完成')], compensated: ['↺', 'var(--ink-2)', tr('undone', '已撤销')],
    cancelled: ['–', 'var(--ink-2)', tr('cancelled', '已取消')], skipped: ['–', 'var(--ink-2)', tr('skipped', '未执行')],
  }
  const [glyph, color, label] = map[s.status] ?? ['○', 'var(--ink-2)', tr('waiting for you', '等你确认')]
  return <span className="step-glyph mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold" style={{ color, borderColor: color }} title={label} aria-label={label}>{glyph}</span>
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
 * The rows to check come first; account numbers fold under "More details". A name that doesn't match and the
 * warning for a payment's purpose stand out as notices. How the request was checked is one tap away.
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
  const asking = waiting ? pending.filter((s) => s.purpose_options) : []
  const needsPurpose = pending.some((s) => s.purpose_needed)
  const seal = sealFor(p)
  const rows = single?.details ?? []
  const { mismatch, warning, scam } = single ? alarmsOf(single) : { mismatch: undefined, warning: undefined, scam: false }
  const main = rows.filter((d) => d !== mismatch && d !== warning && !MORE_LABEL.test(d.label))
  const more = rows.filter((d) => MORE_LABEL.test(d.label))

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
    <div className="confirm-card card">
      <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4 max-sm:px-4">
        <div className="min-w-0">
          <p className="text-[1.1rem] font-semibold leading-tight">{title(p, tr)}</p>
          {showRequest && <p className="mt-0.5 truncate text-sm text-ink2" title={p.request}>“{p.request}”</p>}
        </div>
        {waiting ? <TierTag tier={p.tier} /> : seal === 'done' || seal === 'scheduled' ? <Seal kind={seal} size={58} /> : null}
      </div>

      <div className="px-5 pb-4 max-sm:px-4">
        {single && rows.length > 0 ? <>
          <dl className="divide-y divide-[var(--rule)]">
            {main.map((d) => {
              const amount = d.value === yuan(single.fen ?? -1)
              return (
                <div key={d.label} className={`flex justify-between gap-4 py-2.5 text-body ${amount ? 'items-center' : 'items-baseline'}`}>
                  <dt className="shrink-0 text-ink2">{d.label}</dt>
                  <dd className={`min-w-0 text-right ${amount ? 'num text-[1.75rem] font-semibold leading-none tracking-[-0.01em]' : 'font-semibold'}`}>{d.value}</dd>
                </div>
              )
            })}
          </dl>
          {mismatch && <Notice tone="alert" className="mt-3" title={mismatch.label}>{mismatch.value}</Notice>}
          {warning && <Notice tone={scam ? 'alert' : 'highlight'} className="mt-3" title={warning.label}>{warning.value}</Notice>}
          {more.length > 0 && (
            <details className="mt-2 text-body">
              <summary className="fold flex min-h-10 cursor-pointer items-center gap-1 text-sm font-semibold text-ink2 hover:text-ink">{tr('More details', '更多信息')}<ChevronDown size={15} aria-hidden /></summary>
              <dl className="divide-y divide-[var(--rule)]">
                {more.map((d) => <div key={d.label} className="flex items-baseline justify-between gap-4 py-2"><dt className="shrink-0 text-ink2">{d.label}</dt><dd className="min-w-0 text-right font-semibold">{d.value}</dd></div>)}
              </dl>
            </details>
          )}
        </> : (
          <ol className="space-y-2.5 py-1">
            {p.steps.map((s) => {
              // each step keeps its own warnings on a card with several steps
              const own = s.status === 'pending' ? alarmsOf(s) : null
              return (
                <li key={s.id} className="flex gap-2.5 text-body leading-snug">
                  {/* keyed by status: a step that changes state shows its new symbol with a small pop */}
                  <StepIcon key={s.status} s={s} />
                  <span className={`min-w-0 flex-1 ${s.status === 'cancelled' || s.status === 'skipped' ? 'text-ink2 line-through' : ''}`}>
                    {s.text}
                    {s.status === 'waiting' && s.run_at && <span className="block text-xs text-ink2">{tr(`runs ${stamp(s.run_at)}, after the rules check it again`, `${stamp(s.run_at)} 执行，执行前会再检查一次`)}</span>}
                    {own?.mismatch && <Notice tone="alert" className="mt-2" title={own.mismatch.label}>{own.mismatch.value}</Notice>}
                    {own?.warning && <Notice tone={own.scam ? 'alert' : 'highlight'} className="mt-2" title={own.warning.label}>{own.warning.value}</Notice>}
                  </span>
                </li>
              )
            })}
            {total > 0 && p.steps.length > 1 && <li className="flex items-center justify-between border-t border-rule pt-2.5"><span className="text-ink2">{tr('Total', '合计')}</span><span className="num text-[1.5rem] font-semibold">{yuan(total)}</span></li>}
          </ol>
        )}

        {waiting && deciding?.rule_text && (
          <p className="mt-3 text-sm leading-snug text-ink2">
            {p.tier === 'red' ? tr('You’ll need your PIN and an SMS code, or a passkey. Why: ', '需要交易密码和短信验证码，或通行密钥。原因：') : tr('Why: ', '原因：')}
            <span className={signals.length ? 'font-semibold text-cinnabar' : ''}>{reasons.join(lang === 'zh' ? '；' : '; ')}</span>{lang === 'zh' ? '。' : '.'}
          </p>
        )}
        {p.status === 'failed' && failed?.error && <Notice tone="alert" className="mt-3">{failed.error}</Notice>}
        {p.status === 'scheduled' && <p className="mt-3 text-sm leading-snug text-ink2">{tr('The rest runs at its time, after the rules check it again. You can still stop it.', '剩下的步骤会按时执行，执行前会再检查一次，现在仍可停止。')}</p>}
        {p.status === 'clarifying' && <p className="mt-3 text-sm leading-snug text-ink2">{tr('Answer the question above to continue.', '回答上面的问题即可继续。')}</p>}

        {asking.map((s) => (
          <fieldset key={s.id} className="tile mt-3 p-4 max-sm:p-3">
            <legend className="float-left w-full font-semibold">{(() => {
              // with several payments on one card, say which one the question is about
              const to = p.steps.length > 1 ? s.details?.find((d) => PAYEE_LABEL.test(d.label))?.value : undefined
              return to ? tr(`What is the payment to ${to} for?`, `给${to}的这笔钱是做什么用的？`) : tr('What is this payment for?', '这笔钱是做什么用的？')
            })()}</legend>
            <p className="mb-3 text-xs text-ink2">{tr('Your answer decides the warning you see, and some answers hold the money until tomorrow. Only you can answer this, not the assistant.', '你的回答决定看到哪条提醒，有的回答会让钱次日才到账。只能由你本人选择，助手不会替你回答。')}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {s.purpose_options!.map((o) => (
                <button key={o.value} type="button" aria-pressed={s.purpose === o.value} disabled={busy}
                  onClick={() => void act(() => api.purpose(p.id, s.id, o.value, lang))}
                  className={`min-h-11 rounded-box px-3 py-2 text-left text-sm font-semibold leading-snug ${s.purpose === o.value ? 'bg-[var(--action)] text-[var(--action-ink)]' : 'bg-[var(--card)] shadow-[0_1px_2px_var(--shadow)] hover:shadow-[0_0_0_2px_var(--action)]'}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}

        {waiting && <ShopPicker plan={p} busy={busy} onPick={(stepId, place) => void act(() => api.edit(p.id, stepId, { shop: place.id }, lang))} />}

        {waiting && (
          <div className="confirm-actions mt-4 flex flex-wrap items-center gap-2">
            {p.tier === 'red'
              ? <button type="button" className="btn bg-cinnabar px-5 text-white hover:brightness-110 max-sm:flex-1" disabled={busy || needsPurpose} onClick={() => setVerifying(true)}>{tr('Verify and confirm', '验证并确认')}</button>
              : <button type="button" className="btn btn-ink px-6 max-sm:flex-1" disabled={busy || needsPurpose} onClick={() => void act(() => api.approve(p.id, p.approval_hash!, lang))}>{tr('Confirm', '确认')}</button>}
            <button type="button" className="btn btn-line px-5" disabled={busy} onClick={() => void act(() => api.cancel(p.id, false, lang))}>{tr('Cancel', '取消')}</button>
            {needsPurpose && <span className="w-full text-sm font-semibold text-[var(--amber-ink)] sm:w-auto">{tr('Choose what it is for first.', '请先选择用途。')}</span>}
          </div>
        )}
        {p.status === 'scheduled' && <button type="button" className="btn btn-line mt-3" disabled={busy} onClick={() => void act(() => api.cancel(p.id, true, lang))}>{tr('Stop and undo', '停止并撤销')}</button>}
        {p.status === 'done' && p.steps.some((s) => s.action === 'transfer' || s.action === 'phone_transfer') && (
          <Link to="/send?tab=transfers" className="mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-[var(--action)]">{tr('See where the money is →', '查看到账进度 →')}</Link>
        )}
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-cinnabar">{error}</p>}
        <PlannedBy plan={p} />

        <details className="tile mt-3 px-4 py-1">
          <summary className="fold flex min-h-10 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-ink2 hover:text-ink">{waiting ? tr('Why do I need to confirm?', '为什么要确认？') : tr('How this was checked', '是怎么检查的？')}<ChevronDown size={15} aria-hidden /></summary>
          <div className="pb-3"><Decision plan={p} /></div>
        </details>
      </div>
      {verifying && <VerifyDialog plan={p} hasPasskey={!!overview.data?.has_passkey} onClose={() => setVerifying(false)} />}
    </div>
  )
}

/** Who understood the request: the AI model, or the bank's built-in rules when the model is off or didn't answer. The tier is always the rules'. */
function PlannedBy({ plan: p }: { plan: Plan }) {
  const { tr } = useLang()
  const text = p.source === 'ai'
    ? tr(`Understood and planned by the AI model (${p.model || 'AI'}); the bank's rules set the tier`, `由 AI 模型（${p.model || 'AI'}）理解并拟定计划，等级由银行规则决定`)
    : p.source === 'offline_fallback' ? tr('The AI model wasn’t available, so the built-in rules planned this', 'AI 模型暂时不可用，这次由内置规则拟定')
    : p.source === 'offline' ? tr('Planned by the built-in rules (the AI model is off)', '由内置规则拟定（未启用 AI 模型）')
    : p.source === 'followup' ? tr('Completed from your previous request by the bank’s code', '按你上一句话，由银行代码补全')
    : null
  if (!text) return null
  return <p className="mt-3 flex items-start gap-1.5 text-xs text-ink2"><Sparkles size={13} className={`mt-0.5 shrink-0 ${p.source === 'ai' ? 'text-[var(--action)]' : ''}`} aria-hidden />{text}</p>
}

/** Kept for older call sites: the plan is shown as its confirmation card. */
export const PlanView = ConfirmCard

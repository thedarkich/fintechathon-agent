import type { ReactNode } from 'react'
import type { Plan, PlanStep } from '../api/types'
import { useLang } from '../i18n'
import { actionLabel } from './StepRow'

const MARK = {
  green: { glyph: '✓', color: 'var(--jade)' },
  yellow: { glyph: '◇', color: 'var(--ink)' },
  red: { glyph: '◆', color: 'var(--cinnabar)' },
  failed: { glyph: '✕', color: 'var(--cinnabar)' },
  none: { glyph: '·', color: 'var(--ink-2)' },
}

function mark(s: PlanStep) {
  if (s.status === 'failed') return MARK.failed
  return s.tier ? MARK[s.tier] : MARK.none
}

/**
 * Who decided what: the AI only turns the request into proposed steps;
 * the bank's fixed rules give each step its tier; the customer approves.
 */
export function Decision({ plan: p, children }: { plan: Plan; children?: ReactNode }) {
  const { tr, lang } = useLang()
  const decided = p.steps.filter((s) => s.tier)
  const source = p.source === 'ai' ? tr('the AI model', 'AI 模型') : p.source === 'scheduler' ? tr('the scheduler (a scheduled step needs approval again)', '定时任务（预约的步骤需要重新确认）') : tr('the offline planner', '离线规划器')
  return (
    <section aria-label={tr('Who decided what', '谁做了什么决定')} className="overflow-hidden ruled text-sm">
      <div className="border-b border-rule p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{tr('1 · AI reads and proposes', '1 · AI 理解、提议')}</p>
        <p className="mt-1.5 font-semibold leading-snug">
          {p.steps.length === 0
            ? tr('No steps proposed.', '没有提出任何步骤。')
            : tr(`Proposed ${p.steps.length} step${p.steps.length > 1 ? 's' : ''}: ${p.steps.map((s) => actionLabel(s.action, 'en')).join(' → ')}.`, `提出 ${p.steps.length} 个步骤：${p.steps.map((s) => actionLabel(s.action, 'zh')).join(' → ')}。`)}
        </p>
        <p className="mt-1 leading-snug text-ink2">{tr(`Planned by ${source}.`, `由${source}规划。`)}</p>
        {p.flags.length > 0 && (
          <p className="mt-1 leading-snug">
            <strong className="text-cinnabar">{tr('Flagged by screening.', '安全筛查已标记。')}</strong> {tr('The request tried to get around the rules, so steps that need a confirmation now need strong verification.', '请求中有试图绕过规则的内容，原本只需确认的步骤改为需要强验证。')}
          </p>
        )}
        <p className="mt-2 text-xs leading-snug text-ink2">{tr('The AI cannot move money or approve anything. It can only propose steps from a fixed list.', 'AI 不能动钱，也不能批准任何操作，只能从固定的操作清单里提出步骤。')}</p>
      </div>

      <div className="border-b border-rule p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{tr('2 · Bank rules check and decide', '2 · 银行规则检查、拍板')}</p>
        {decided.length === 0 ? (
          <p className="mt-1.5 leading-snug text-ink2">{tr('Nothing to decide yet.', '暂时没有需要判定的步骤。')}</p>
        ) : (
          <ol className="mt-1.5 space-y-1.5">
            {decided.map((s) => (
              <li key={s.id} className="flex gap-2 leading-snug">
                <span className="w-3 shrink-0 text-center font-bold" style={{ color: mark(s).color }} aria-hidden>{mark(s).glyph}</span>
                <span className="min-w-0">
                  <span className={s.status === 'cancelled' || s.status === 'skipped' ? 'text-ink2 line-through' : ''}>{s.text}</span>
                  {s.rule_text && <span className="block text-xs text-ink2">{s.rule_text}{s.rule ? ` · ${s.rule}` : ''}</span>}
                  {s.signals.map((signal) => <span key={signal} className="block text-xs font-semibold text-cinnabar">{signal}</span>)}
                  {s.error && <span className="block text-xs text-cinnabar">{s.error}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-xs leading-snug text-ink2">
          {lang === 'zh'
            ? '✓ 自动执行　◇ 需你确认　◆ 需交易密码加短信验证码或通行密钥'
            : '✓ runs automatically  ◇ needs your confirmation  ◆ needs your PIN plus an SMS code or passkey'}
        </p>
      </div>

      <div className="p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink2">{tr('3 · You decide', '3 · 你来拍板')}</p>
        {children}
      </div>
    </section>
  )
}

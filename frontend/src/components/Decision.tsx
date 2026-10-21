import type { Plan, PlanStep } from '../api/types'
import { useLang } from '../i18n'
import { actionLabel } from '../lib/actions'

const MARK = {
  green: { glyph: '✓', color: 'var(--jade)' },
  yellow: { glyph: '●', color: 'var(--ink)' },
  red: { glyph: '●', color: 'var(--cinnabar)' },
  failed: { glyph: '✕', color: 'var(--cinnabar)' },
  none: { glyph: '·', color: 'var(--ink-2)' },
}

function mark(s: PlanStep) {
  if (s.status === 'failed') return MARK.failed
  return s.tier ? MARK[s.tier] : MARK.none
}

/**
 * How a request was checked, in plain words: the AI understood it and proposed steps;
 * the bank's fixed rules decided what each step needs; the customer has the last word.
 */
export function Decision({ plan: p }: { plan: Plan }) {
  const { tr } = useLang()
  const decided = p.steps.filter((s) => s.tier || s.error)
  const screen = p.source === 'screen'  // filled in on a screen: no AI took part
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-semibold">{screen ? tr('1. You filled in the form', '1. 你填写了表单') : tr('1. The AI understood your request', '1. AI 理解了你的话')}</p>
        <p className="mt-0.5 leading-snug text-ink2">
          {screen ? tr(`The screen sent one step: ${p.steps.map((s) => actionLabel(s.action, 'en')).join(' → ')}. No AI took part.`,
            `页面提交了一个步骤：${p.steps.map((s) => actionLabel(s.action, 'zh')).join(' → ')}，没有经过 AI。`)
          : p.steps.length === 0
            ? tr('It proposed no steps.', '没有提出任何步骤。')
            : tr(`It proposed ${p.steps.length} step${p.steps.length > 1 ? 's' : ''}: ${p.steps.map((s) => actionLabel(s.action, 'en')).join(' → ')}. It can only choose from a fixed list of bank actions; it can't move money, approve anything or see your account.`,
              `提出了 ${p.steps.length} 个步骤：${p.steps.map((s) => actionLabel(s.action, 'zh')).join(' → ')}。它只能从固定的银行操作里选，不能动钱、不能批准，也看不到你的账户。`)}
        </p>
        {p.flags.length > 0 && (
          <p className="mt-1 leading-snug text-cinnabar">{screen
            ? tr('Your note used words scammers use (like “safe account”), so this needs your PIN and a code.', '你的备注里有诈骗常用的说法（比如“安全账户”），所以需要交易密码和验证码。')
            : tr('Your message looked like an attempt to get around the safety rules, so anything that needed a confirmation now needs your PIN and a code.', '你的消息看起来像是想绕过安全规则，所以原本点确认即可的操作，现在需要交易密码和验证码。')}</p>
        )}
      </div>
      <div>
        <p className="font-semibold">{tr('2. The bank’s rules checked each step', '2. 银行规则检查了每一步')}</p>
        {decided.length === 0 ? (
          <p className="mt-0.5 leading-snug text-ink2">{tr('Nothing needed checking yet.', '暂时没有需要检查的步骤。')}</p>
        ) : (
          <ol className="mt-1 space-y-1.5">
            {decided.map((s) => (
              <li key={s.id} className="flex gap-2 leading-snug">
                <span className="w-3 shrink-0 text-center font-semibold" style={{ color: mark(s).color }} aria-hidden>{mark(s).glyph}</span>
                <span className="min-w-0">
                  <span className={s.status === 'cancelled' || s.status === 'skipped' ? 'text-ink2 line-through' : ''}>{s.text}</span>
                  {s.rule_text && <span className="block text-xs text-ink2">{s.rule_text}</span>}
                  {s.signals.map((signal) => <span key={signal} className="block text-xs font-semibold text-cinnabar">{signal}</span>)}
                  {s.error && <span className="block text-xs text-cinnabar">{s.error}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <p className="font-semibold">{tr('3. You decide', '3. 最后由你决定')}</p>
        <p className="mt-0.5 leading-snug text-ink2">{tr('Questions are answered right away. Payments and changes wait for your OK. Large or risky ones also need your PIN and an SMS code, which the AI never sees. Every step is kept in your history.', '查询直接办好；付款和修改要等你确认；大额或有风险的还需要交易密码和短信验证码，AI 看不到它们。每一步都记在你的记录里。')}</p>
      </div>
    </div>
  )
}

import { Section } from '../components/Chrome'
import { useLang } from '../i18n'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { useOverview } from './Shell'

/** Cards are changed only through the assistant, so every change passes the same rules and lands in the audit log. */
export default function CardsPage() {
  const { tr } = useLang()
  const overview = useOverview()
  const { send, pending } = useChat()
  const ask = (text: string) => void send(text)
  return (
    <div className="px-4 pb-8 pt-5">
      <h1 className="text-2xl font-extrabold tracking-tight">{tr('Cards', '银行卡')}</h1>
      <p className="mt-1 text-sm text-ink2">{tr('Each button asks the assistant, so the change goes through the same checks: safer settings need a confirmation, riskier ones need strong verification.', '每个按钮都会交给助手办理，同样经过规则检查：更安全的设置只需确认，风险更高的需要强验证。')}</p>
      {overview.data?.cards.map((c) => {
        const id = c.last4
        const switches = [
          ['online', c.online, tr('Online payments', '网上支付'), tr('online payments', '网上支付')],
          ['overseas', c.overseas, tr('Overseas payments', '境外支付'), tr('overseas payments', '境外支付')],
          ['atm', c.atm, tr('ATM withdrawals', 'ATM 取现'), tr('ATM withdrawals', 'ATM 取现')],
          ['contactless', c.contactless, tr('Contactless', '闪付'), tr('contactless', '闪付')],
        ] as const
        return (
          <Section key={c.id} title={`${c.name} ****${c.last4}`}>
            <div className="rounded-2xl border border-rule bg-sheet p-4">
              <p className="text-sm text-ink2">{tr('Status', '状态')}: <span className="font-semibold text-ink">{{ active: tr('Active', '正常'), frozen: tr('Frozen', '已冻结'), lost: tr('Reported lost', '已挂失'), pending: tr('On its way', '寄送中') }[c.status]}</span></p>
              <p className="num text-sm text-ink2">{tr('Daily limit', '日限额')}: <span className="font-semibold text-ink">{yuan(c.daily_limit_fen)}</span></p>
              <ul className="mt-3 divide-y divide-[var(--rule)]">
                {switches.map(([key, on, label, word]) => (
                  <li key={key} className="flex items-center justify-between py-2 text-sm">
                    <span>{label}</span>
                    <button disabled={!!pending || c.status === 'lost'} className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? 'bg-jade-wash text-jade' : 'bg-well text-ink2'}`}
                      onClick={() => ask(on ? tr(`Turn off ${word} on card ${id}`, `关闭尾号${id}的卡的${word}`) : tr(`Turn on ${word} on card ${id}`, `开通尾号${id}的卡的${word}`))}>
                      {on ? tr('On', '已开启') : tr('Off', '已关闭')}
                    </button>
                  </li>
                ))}
              </ul>
              {c.status !== 'lost' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.status === 'active'
                    ? <button className="btn btn-quiet" disabled={!!pending} onClick={() => ask(tr(`Freeze card ${id}`, `冻结尾号${id}的卡`))}>{tr('Freeze', '冻结')}</button>
                    : <button className="btn btn-quiet" disabled={!!pending} onClick={() => ask(tr(`Unfreeze card ${id}`, `解冻尾号${id}的卡`))}>{tr('Unfreeze', '解冻')}</button>}
                  <button className="btn btn-quiet" disabled={!!pending} onClick={() => ask(tr(`Change the daily limit of card ${id}`, `调整尾号${id}的卡的限额`))}>{tr('Change limit', '调整限额')}</button>
                  <button className="btn btn-quiet text-vermilion" disabled={!!pending} onClick={() => ask(tr(`Report card ${id} lost`, `挂失尾号${id}的卡`))}>{tr('Report lost', '挂失')}</button>
                </div>
              )}
            </div>
          </Section>
        )
      })}
      <div className="mt-6"><button className="btn btn-primary w-full" disabled={!!pending} onClick={() => ask(tr('Apply for a virtual card for online shopping', '申请一张网购用的虚拟卡'))}>{tr('Apply for a virtual card', '申请虚拟卡')}</button></div>
    </div>
  )
}

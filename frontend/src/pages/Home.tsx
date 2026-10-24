import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, SendHorizontal } from 'lucide-react'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Icon, type IconName } from '../components/Icon'
import { EMPTY, LIST, Section, ServiceTile, type Tint } from '../components/bits'
import { TxnList } from '../components/Results'
import { useAuth } from '../lib/auth'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'

const BIRTHDAY: [string, string] = ["It's my wife's birthday next month, help me prepare", '下个月老婆生日，帮我准备一下']

/** The brief's six scenarios, one service each, in its order. The last one hands a whole plan to the assistant. */
const SCENARIOS: [string, IconName, Tint, [string, string]][] = [
  ['/send', 'send', 'green', ['Transfers', '转账']],
  ['/bills', 'chart', 'blue', ['Spending', '账单']],
  ['/wealth', 'trend', 'violet', ['Invest', '理财']],
  ['/controls', 'card', 'amber', ['Cards', '卡片']],
  ['/subscriptions', 'bell', 'cyan', ['Subscriptions', '自动续费']],
  ['birthday', 'agents', 'ink', ['Several at once', '多件事一起办']],
]

const HIDE_KEY = 'hide-balance'

function hiddenStored(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
}

/** Home, laid out like a bank app: the balance with the services under it, the assistant, then what needs you and what just happened. */
export default function Home() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const { send, pending } = useChat()
  const overview = useOverview()
  const subs = useQuery({ queryKey: ['subscriptions', lang], queryFn: () => api.subscriptions(lang) })
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => api.notifications(lang) })
  const recent = useQuery({ queryKey: ['transactions', 'home'], queryFn: () => api.transactions(30, '', 5) })
  const forYou = (notes.data?.items ?? []).filter((n) => n.suggestion).slice(0, 2)
  const [hidden, setHidden] = useState(hiddenStored)
  const [ask, setAsk] = useState('')
  const data = overview.data
  const checking = data?.accounts.find((a) => a.kind === 'checking')
  const money = (fen: number) => (hidden ? '¥ ••••' : yuan(fen))
  const hour = data ? Number(new Date(data.now).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })) : 12
  const hello = hour < 11 ? tr('Good morning', '早上好') : hour < 18 ? tr('Good afternoon', '下午好') : tr('Good evening', '晚上好')
  const next = (subs.data?.items ?? []).filter((s) => s.status === 'active').sort((a, b) => a.next_charge_on.localeCompare(b.next_charge_on))[0]
  const link = (to: string) => (to === 'birthday' ? `/assistant?ask=${encodeURIComponent(tr(BIRTHDAY[0], BIRTHDAY[1]))}` : to)
  const todo = forYou.length + (next ? 1 : 0)

  const toggle = () => {
    setHidden(!hidden)
    try { localStorage.setItem(HIDE_KEY, hidden ? '0' : '1') } catch { /* the choice lasts this visit */ }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ask.trim()) void send(ask.trim())
  }

  return (
    <main tabIndex={-1} className="page-content">
      <h1 className="mb-5">{user?.name ? tr(`${hello}, ${user.name}`, `${hello}，${user.name}`) : hello}</h1>

      <section aria-label={tr('Current account', '活期账户')} className="card home-card">
        <div className="home-money">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-sm text-ink2">{checking ? `${checking.name} ·${checking.number.slice(-4)}` : tr('Current account', '活期账户')}</span>
              <button type="button" onClick={toggle} className="flex h-11 w-11 items-center justify-center rounded-full text-ink2 hover:bg-[var(--field)]"
                aria-label={hidden ? tr('Show amounts', '显示金额') : tr('Hide amounts', '隐藏金额')} aria-pressed={hidden}>
                {hidden ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {data && checking ? <p className="home-balance num">{money(checking.fen)}</p> : <p className="mt-1 h-12 w-56 animate-pulse rounded-box bg-paper2" aria-hidden />}
          </div>
          {data && (
            <dl className="home-figures">
              <div><dt>{tr('Spent this month', '本月支出')}</dt><dd className="num">{money(data.month_spend_fen)}</dd></div>
              <div><dt>{tr('Total', '总资产')}</dt><dd className="num">{money(data.cash_fen + data.invest_fen)}</dd></div>
            </dl>
          )}
        </div>
        <nav aria-label={tr('Services', '服务')} className="home-services">
          {SCENARIOS.map(([to, icon, tint, name]) => <ServiceTile key={to} to={link(to)} icon={icon} tint={tint} label={tr(name[0], name[1])} />)}
        </nav>
      </section>

      <form onSubmit={submit} className="home-ask">
        <Icon name="chat" size={19} className="text-[var(--action)]" />
        <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={2000} autoComplete="off" aria-label={tr('Ask the assistant', '问问助手')}
          placeholder={tr('Ask the assistant, e.g. where did my money go?', '问问助手，比如“上个月钱花哪了”')}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-body outline-none focus-visible:outline-none" />
        <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-box bg-[var(--action)] text-[var(--action-ink)] disabled:bg-paper2 disabled:text-ink2" disabled={!ask.trim() || !!pending} aria-label={tr('Ask', '发送')}>
          <SendHorizontal size={18} />
        </button>
      </form>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <Section title={todo ? tr(`To do (${todo})`, `待办（${todo}）`) : tr('To do', '待办')}>
          {notes.data && subs.data && !todo ? <p className={EMPTY}>{tr('Nothing needs you right now.', '暂时没有要办的事。')}</p> : (
            <ul className={LIST}>
              {forYou.map((n) => {
                const alert = n.kind === 'anomaly'
                return (
                  <li key={n.id} className="todo-row">
                    <span className={`todo-icon tint-${alert ? 'red' : 'violet'}`} aria-hidden><Icon name={alert ? 'flag' : n.kind === 'birthday' ? 'clock' : 'bell'} size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium leading-snug ${alert ? 'text-cinnabar' : ''}`}>{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink2">{n.body}</p>
                    </div>
                    {alert
                      ? <Link to="/bills?tab=alerts" className="btn btn-line todo-action">{tr('Take a look', '去看看')}</Link>
                      : <button type="button" disabled={!!pending} onClick={() => void send(n.suggestion!)} className="btn btn-ink todo-action">{tr('Let the assistant do it', '让助手来办')}</button>}
                  </li>
                )
              })}
              {next && (
                <li>
                  <Link to="/subscriptions" className="todo-row is-plain hover:bg-[var(--sheet)]">
                    <span className="todo-icon tint-amber" aria-hidden><Icon name="clock" size={18} /></span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{tr(`Next charge: ${next.merchant}`, `下次扣费：${next.merchant}`)}</p>
                      <p className="mt-0.5 text-sm text-ink2">{tr(`Renews ${next.next_charge_on.slice(5)}`, `${next.next_charge_on.slice(5)} 续费`)}{next.remind_days_before ? tr(` · reminder ${next.remind_days_before} days before`, ` · 提前 ${next.remind_days_before} 天提醒`) : ''}</p>
                    </div>
                    <span className="num shrink-0 font-semibold">{money(next.fen)}</span>
                  </Link>
                </li>
              )}
            </ul>
          )}
        </Section>

        <Section title={tr('Recent', '最近交易')} aside={<Link to="/bills?tab=transactions" className="flex min-h-10 items-center px-1 text-sm font-medium text-[var(--action)]">{tr('All', '全部')}</Link>}>
          {recent.data ? (recent.data.items.length ? <TxnList items={recent.data.items} hidden={hidden} /> : <p className={EMPTY}>{tr('No transactions yet.', '还没有交易。')}</p>)
            : <div className="card h-64 animate-pulse" aria-hidden />}
        </Section>
      </div>
    </main>
  )
}

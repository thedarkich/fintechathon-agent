import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, SendHorizontal } from 'lucide-react'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Icon, type IconName } from '../components/Icon'
import { ServiceTile } from '../components/bits'
import { useAuth } from '../lib/auth'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { category, stamp, yuan } from '../lib/format'

/** Everything the bank does, one tap each: the first screen after signing in. */
const SERVICES: [string, IconName, string, string][] = [
  ['/qr', 'qr', 'QR pay', '扫码付'],
  ['/send', 'send', 'Transfers', '转账'],
  ['/payments', 'receipt', 'Payments', '缴费'],
  ['/accounts', 'bank', 'My bank', '我的银行'],
  ['/bills', 'chart', 'Spending', '账单'],
  ['/wealth', 'trend', 'Invest', '理财'],
  ['/controls', 'card', 'Cards', '卡片'],
  ['/assistant', 'chat', 'Assistant', '助手'],
]

const HIDE_KEY = 'hide-balance'

function hiddenStored(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
}

export default function Home() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const { send, pending } = useChat()
  const overview = useOverview()
  const bills = useQuery({ queryKey: ['bills', lang], queryFn: () => api.bills(lang) })
  const recent = useQuery({ queryKey: ['transactions', 'home'], queryFn: () => api.transactions(30, '', 6) })
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => api.notifications(lang) })
  const forYou = (notes.data?.items ?? []).filter((n) => n.suggestion).slice(0, 2)
  const [hidden, setHidden] = useState(hiddenStored)
  const [ask, setAsk] = useState('')
  const data = overview.data
  const checking = data?.accounts.find((a) => a.kind === 'checking')
  const money = (fen: number) => (hidden ? '¥ ••••' : yuan(fen))
  const hour = data ? Number(new Date(data.now).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })) : 12
  const hello = hour < 11 ? tr('Good morning', '早上好') : hour < 18 ? tr('Good afternoon', '下午好') : tr('Good evening', '晚上好')
  const due = (bills.data?.items ?? []).filter((b) => b.due_fen)

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
      <h1 className="mb-4">{user?.name ? tr(`${hello}, ${user.name}`, `${hello}，${user.name}`) : hello}</h1>
      <form onSubmit={submit} className="mb-6 flex items-center gap-3 rounded-[14px] bg-[var(--field)] p-1.5 pl-4 focus-within:shadow-[0_0_0_2px_var(--action)]">
        <Icon name="search" size={19} className="text-[var(--action)]" />
        <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={2000} aria-label={tr('Ask the assistant', '问问助手')}
          placeholder={tr('Ask the assistant, e.g. where did my money go?', '问问助手，比如“上个月钱花哪了”')}
          className="min-w-0 flex-1 bg-transparent py-2 text-[0.97rem] outline-none focus-visible:outline-none" />
        <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[var(--action)] text-[var(--action-ink)] disabled:opacity-40" disabled={!ask.trim() || !!pending} aria-label={tr('Ask', '发送')}>
          <SendHorizontal size={18} />
        </button>
      </form>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-6">
          <section aria-label={tr('Current account', '活期账户')} className="rounded-panel px-6 pb-6 pt-5 text-white" style={{ background: 'var(--hero)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm opacity-85">{checking ? `${checking.name} ·${checking.number.slice(-4)}` : tr('Current account', '活期账户')}</span>
              <button type="button" onClick={toggle} className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/15"
                aria-label={hidden ? tr('Show amounts', '显示金额') : tr('Hide amounts', '隐藏金额')} aria-pressed={hidden}>
                {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {data && checking ? <>
              <p className="num mt-1 font-mono text-[2.3rem] font-bold leading-tight">{money(checking.fen)}</p>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 text-sm">
                <span className="opacity-85">{tr('Total', '总资产')} <span className="num font-mono">{money(data.cash_fen + data.invest_fen)}</span></span>
                <span className="opacity-85">{tr('Spent this month', '本月支出')} <span className="num font-mono">{money(data.month_spend_fen)}</span></span>
                <Link to="/accounts" className="ml-auto font-semibold underline-offset-4 hover:underline">{tr('Accounts', '查看账户')} →</Link>
              </div>
            </> : <div className="mt-2 h-20 animate-pulse rounded-box bg-white/15" aria-hidden />}
          </section>

          <nav aria-label={tr('Services', '服务')} className="service-panel">
            {SERVICES.map(([to, icon, en, zh]) => <ServiceTile key={to} to={to} icon={icon} label={tr(en, zh)} />)}
          </nav>

          {forYou.length > 0 && (
            <section aria-labelledby="for-you">
              <h2 id="for-you" className="mb-3 text-xl font-bold tracking-[-0.01em]">{tr('For you', '为你推荐')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {forYou.map((n) => (
                  <article key={n.id} className="flex flex-col rounded-panel p-5 text-white" style={{ background: 'var(--hero)' }}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20"><Icon name={n.kind === 'birthday' ? 'clock' : n.kind === 'anomaly' ? 'flag' : 'bell'} size={19} /></span>
                    <h3 className="mt-3 text-[1.05rem] font-bold leading-snug">{n.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed">{n.body}</p>
                    <button type="button" disabled={!!pending} onClick={() => void send(n.suggestion!)}
                      className="mt-4 w-fit rounded-[12px] bg-cta px-4 py-2 text-sm font-bold text-cta-ink hover:brightness-105">{tr('Let the assistant do it', '让助手来办')}</button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-6">
          {due.length > 0 && (
            <section>
              <h2 className="mb-2 text-xl font-bold">{tr('Bills', '待缴账单')}</h2>
              <ul className="space-y-2">
                {due.map((b) => (
                  <li key={b.id}>
                    <Link to={`/payments?p=${b.provider.code}&a=${encodeURIComponent(b.account)}`} className="flex items-center gap-3 rounded-[18px] bg-[var(--field)] px-4 py-3 hover:bg-[var(--paper-2)]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{b.provider.name}</span>
                        <span className={`block text-xs ${b.autopay ? 'text-jade' : 'text-ink2'}`}>
                          {b.autopay && b.next_autopay_on ? tr(`Pays itself on ${b.next_autopay_on.slice(5)}`, `${b.next_autopay_on.slice(5)} 自动缴费`) : tr('Due now', '待缴')}
                        </span>
                      </span>
                      <span className="num font-mono font-semibold">{money(b.due_fen!)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xl font-bold">{tr('Recent', '最近交易')}</h2>
              <Link to="/bills" className="text-sm font-semibold text-[var(--action)]">{tr('All', '全部')}</Link>
            </div>
            {!recent.data ? <div className="h-48 animate-pulse rounded-box bg-paper2" aria-hidden /> : (
              <ul className="divide-y divide-[var(--rule)] ruled bg-field">
                {recent.data.items.map((t) => (
                  <li key={t.id} className={`flex items-center gap-3 px-4 py-2.5 ${t.status === 'declined' ? 'text-ink2' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.93rem]">{t.merchant}</span>
                      <span className="block text-xs text-ink2">{category(t.category, lang)} · {stamp(t.at)}</span>
                    </span>
                    <span className={`num shrink-0 font-mono text-[0.93rem] ${t.fen > 0 ? 'text-jade' : ''}`}>{t.fen > 0 ? '+' : ''}{money(t.fen)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

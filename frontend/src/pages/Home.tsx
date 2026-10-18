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
import { useTextSize } from '../lib/textSize'

/** Everything the bank does, one tap each: the first screen after signing in. */
const SERVICES: [string, IconName, string, string][] = [
  ['/send', 'send', 'Transfers', '转账'],
  ['/accounts', 'bank', 'Accounts', '账户'],
  ['/bills', 'chart', 'Spending', '账单'],
  ['/wealth', 'trend', 'Invest', '理财'],
  ['/controls', 'card', 'Cards', '卡片'],
  ['/controls?tab=subscriptions', 'bell', 'Subscriptions', '自动续费'],
  ['/ledger', 'receipt', 'History', '记录'],
  ['/assistant', 'chat', 'Assistant', '助手'],
]
// large text (长辈版) keeps Home to the four things used most
const LARGE_SERVICES = ['/send', '/accounts', '/bills', '/assistant']

const HIDE_KEY = 'hide-balance'

function hiddenStored(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
}

export default function Home() {
  const { tr, lang } = useLang()
  const { user } = useAuth()
  const { send, pending } = useChat()
  const overview = useOverview()
  const [size, setSize] = useTextSize()
  const large = size === 'large'
  const subs = useQuery({ queryKey: ['subscriptions', lang], queryFn: () => api.subscriptions(lang) })
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
  const renewing = (subs.data?.items ?? []).filter((s) => s.status === 'active')
    .sort((a, b) => a.next_charge_on.localeCompare(b.next_charge_on)).slice(0, 4)

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
          <section aria-label={tr('Current account', '活期账户')} className="rounded-panel px-6 pb-6 pt-5 text-white shadow-[0_14px_34px_var(--shadow)]" style={{ background: 'var(--hero)' }}>
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

          <nav aria-label={tr('Services', '服务')} className={`service-panel ${large ? 'is-large' : ''}`}>
            {(large ? SERVICES.filter(([to]) => LARGE_SERVICES.includes(to)) : SERVICES).map(([to, icon, en, zh]) => <ServiceTile key={to} to={to} icon={icon} label={tr(en, zh)} />)}
          </nav>
          {large && (
            <p className="-mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-ink2">
              {tr('Large text is on: Home shows the four things used most.', '已开启大字版：首页只显示最常用的四项。')}
              <button type="button" className="font-semibold text-[var(--action)]" onClick={() => setSize('normal')}>{tr('Back to standard', '恢复标准版')}</button>
            </p>
          )}

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
          {renewing.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xl font-bold">{tr('Coming up', '即将扣费')}</h2>
                <Link to="/controls?tab=subscriptions" className="text-sm font-semibold text-[var(--action)]">{tr('All', '全部')}</Link>
              </div>
              <ul className="space-y-2">
                {renewing.map((s) => (
                  <li key={s.id}>
                    <Link to="/controls?tab=subscriptions" className="flex items-center gap-3 rounded-[18px] border border-rule bg-paper px-4 py-3 shadow-[0_4px_12px_var(--shadow)] hover:border-[var(--action)]">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{s.merchant}</span>
                        <span className={`block text-xs ${s.remind_days_before ? 'text-jade' : 'text-ink2'}`}>
                          {tr(`Renews ${s.next_charge_on.slice(5)}`, `${s.next_charge_on.slice(5)} 续费`)}
                          {s.remind_days_before ? tr(` · reminder ${s.remind_days_before} days before`, ` · 提前 ${s.remind_days_before} 天提醒`) : ''}
                        </span>
                      </span>
                      <span className="num font-mono font-semibold">{money(s.fen)}</span>
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

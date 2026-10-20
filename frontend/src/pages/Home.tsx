import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Eye, EyeOff, SendHorizontal } from 'lucide-react'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Icon, type IconName } from '../components/Icon'
import { IconDot, Notice, Section, ServiceTile, type Tint } from '../components/bits'
import { useAuth } from '../lib/auth'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { useTextSize } from '../lib/textSize'

const BIRTHDAY: [string, string] = ["It's my wife's birthday next month, help me prepare", '下个月老婆生日，帮我准备一下']

/** The brief's six scenarios, one tile each, in its order. The last one hands a whole plan to the assistant. */
const SCENARIOS: [string, IconName, Tint, [string, string], [string, string]][] = [
  ['/send', 'send', 'green', ['Transfers', '转账'], ['Phone, payees, scheduled', '手机号、收款人、预约']],
  ['/bills', 'chart', 'blue', ['Spending', '账单'], ['Where it went, anything odd', '花在哪了、可疑交易']],
  ['/wealth', 'trend', 'violet', ['Invest', '理财'], ['Holdings and your risk level', '持仓、风险等级']],
  ['/controls', 'card', 'amber', ['Cards', '卡片'], ['Freeze, limits, report lost', '冻结、限额、挂失']],
  ['/subscriptions', 'bell', 'cyan', ['Subscriptions', '自动续费'], ['Next charge, paid twice', '下次扣费、重复订阅']],
  ['birthday', 'agents', 'ink', ['Many things in one sentence', '一句话办多件事'], ['e.g. plan a birthday', '比如准备生日']],
]
// on a phone the tab bar already has Transfers and Spending
const TABBED = ['/send', '/bills']
// large text (长辈版) keeps Home to the four things used most
const LARGE = ['/send', '/bills', '/controls', '/subscriptions']

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
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => api.notifications(lang) })
  const forYou = (notes.data?.items ?? []).filter((n) => n.suggestion).slice(0, 2)
  const [hidden, setHidden] = useState(hiddenStored)
  const [ask, setAsk] = useState('')
  const data = overview.data
  const checking = data?.accounts.find((a) => a.kind === 'checking')
  const money = (fen: number) => (hidden ? '¥ ••••' : yuan(fen))
  const hour = data ? Number(new Date(data.now).toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })) : 12
  const hello = hour < 11 ? tr('Good morning', '早上好') : hour < 18 ? tr('Good afternoon', '下午好') : tr('Good evening', '晚上好')
  const next = (subs.data?.items ?? []).filter((s) => s.status === 'active').sort((a, b) => a.next_charge_on.localeCompare(b.next_charge_on))[0]
  const tiles = large ? SCENARIOS.filter(([to]) => LARGE.includes(to)) : SCENARIOS
  const link = (to: string) => (to === 'birthday' ? `/assistant?ask=${encodeURIComponent(tr(BIRTHDAY[0], BIRTHDAY[1]))}` : to)

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
      <form onSubmit={submit} className="mb-6 flex items-center gap-3 rounded-tile border border-rule2 bg-card p-1.5 pl-4 focus-within:border-[var(--action)]">
        <Icon name="chat" size={19} className="text-[var(--action)]" />
        <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={2000} aria-label={tr('Ask the assistant', '问问助手')}
          placeholder={tr('Ask the assistant, e.g. where did my money go?', '问问助手，比如“上个月钱花哪了”')}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-body outline-none focus-visible:outline-none" />
        <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-box bg-[var(--action)] text-[var(--action-ink)] disabled:bg-paper2 disabled:text-ink2" disabled={!ask.trim() || !!pending} aria-label={tr('Ask', '发送')}>
          <SendHorizontal size={18} />
        </button>
      </form>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-6">
          <section aria-label={tr('Current account', '活期账户')} className="card p-6 max-sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="stat-label">{checking ? `${checking.name} ·${checking.number.slice(-4)}` : tr('Current account', '活期账户')}</span>
              <button type="button" onClick={toggle} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink2 hover:bg-[var(--field)]"
                aria-label={hidden ? tr('Show amounts', '显示金额') : tr('Hide amounts', '隐藏金额')} aria-pressed={hidden}>
                {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {data && checking ? <>
              <p className="num text-[2.5rem] font-extrabold leading-tight tracking-[-0.03em] max-sm:text-[2.5rem]">{money(checking.fen)}</p>
              <div className={`mt-4 grid gap-3 ${large ? 'sm:grid-cols-2' : 'grid-cols-2'}`}>
                <div className="tile flex items-center gap-3 p-3.5">
                  <span className="max-sm:hidden"><IconDot icon="wallet" size={36} /></span>
                  <span className="min-w-0"><span className="block text-xs text-ink2">{tr('Spent this month', '本月支出')}</span><span className="num block truncate font-bold">{money(data.month_spend_fen)}</span></span>
                </div>
                <div className="tile flex items-center gap-3 p-3.5">
                  <span className="max-sm:hidden"><IconDot icon="trend" size={36} /></span>
                  <span className="min-w-0"><span className="block text-xs text-ink2">{tr('Total', '总资产')}</span><span className="num block truncate font-bold">{money(data.cash_fen + data.invest_fen)}</span></span>
                </div>
              </div>
            </> : <div className="mt-2 h-28 animate-pulse rounded-box bg-paper2" aria-hidden />}
          </section>

          <nav aria-label={tr('Services', '服务')} className={`service-panel ${large ? 'is-large' : ''}`}>
            {tiles.map(([to, icon, tint, name, sub]) => (
              <ServiceTile key={to} to={link(to)} icon={icon} tint={tint} label={tr(name[0], name[1])} sub={large ? undefined : tr(sub[0], sub[1])}
                className={!large && TABBED.includes(to) ? 'is-tabbed' : ''} />
            ))}
          </nav>
          {large && (
            <p className="-mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-ink2">
              {tr('Large text is on: Home shows the four things used most.', '已开启大字版：首页只显示最常用的四项。')}
              <button type="button" className="min-h-11 font-semibold text-[var(--action)]" onClick={() => setSize('normal')}>{tr('Back to standard', '恢复标准版')}</button>
            </p>
          )}
        </div>

        <Section title={tr('Coming up for you', '为你接下来要办的')}>
          <div className="space-y-3">
            {forYou.map((n) => {
              const action = <button type="button" disabled={!!pending} onClick={() => void send(n.suggestion!)} className="btn btn-ink px-4 text-sm">{tr('Let the assistant do it', '让助手来办')}</button>
              return n.kind === 'anomaly'
                ? <Notice key={n.id} tone="alert" title={n.title}><p className="line-clamp-2">{n.body}</p><div className="mt-2.5"><Link to="/bills?tab=alerts" className="btn btn-line bg-[var(--card)] px-4 text-sm">{tr('Take a look', '去看看')}</Link></div></Notice>
                : (
                  <div key={n.id} className="card flex gap-3 p-4">
                    <IconDot icon={n.kind === 'birthday' ? 'clock' : 'bell'} tint="violet" size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-snug">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ink2">{n.body}</p>
                      <div className="mt-2.5">{action}</div>
                    </div>
                  </div>
                )
            })}
            {next && (
              <Link to="/subscriptions" className="block rounded-tile focus-visible:outline-offset-4">
                <Notice tone="highlight" icon="clock" title={tr(`Next charge: ${next.merchant}`, `下次扣费：${next.merchant}`)}
                  action={<span className="num font-extrabold">{money(next.fen)}</span>}>
                  <span className="text-ink2">{tr(`Renews ${next.next_charge_on.slice(5)}`, `${next.next_charge_on.slice(5)} 续费`)}{next.remind_days_before ? tr(` · reminder ${next.remind_days_before} days before`, ` · 提前 ${next.remind_days_before} 天提醒`) : ''}</span>
                </Notice>
              </Link>
            )}
            {notes.data && subs.data && !forYou.length && !next && <p className="card px-4 py-4 text-sm text-ink2">{tr('Nothing needs you right now.', '暂时没有要办的事。')}</p>}
          </div>
        </Section>
      </div>
    </main>
  )
}

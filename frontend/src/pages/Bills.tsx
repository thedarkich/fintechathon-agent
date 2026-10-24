import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Badge, EMPTY, Notice, PageHead, PageTabs, Pager, Section, Segmented, StatTile, useTab } from '../components/bits'
import { Icon } from '../components/Icon'
import { Bars, Columns, TxnList } from '../components/Results'
import { SpendCalendar } from '../components/SpendCalendar'

const PAGE = 20 // transactions per page on the Transactions tab
import { useChat } from '../lib/chat'
import { category, yuan } from '../lib/format'

/** Card 02, bill analysis: the month at a glance, what looks unusual, and every transaction. */
export default function Bills() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const [tab, setTab] = useTab(['overview', 'alerts', 'transactions'] as const, 'overview')
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const report = useQuery({ queryKey: ['report', period, offset], queryFn: () => api.report(period, offset) })
  const anomalies = useQuery({ queryKey: ['anomalies'], queryFn: api.anomalies })
  const recent = useQuery({ queryKey: ['transactions', 'bills-recent'], queryFn: () => api.transactions(90, '', 7) })
  const txns = useQuery({ queryKey: ['transactions', 'bills', q, page], queryFn: () => api.transactions(90, q, PAGE, (page - 1) * PAGE), placeholderData: keepPreviousData })
  const pages = txns.data ? Math.max(1, Math.ceil(txns.data.count / PAGE)) : 1
  const r = report.data
  const change = r && r.previous_spend_fen ? Math.round(((r.spend_fen - r.previous_spend_fen) / r.previous_spend_fen) * 100) : null
  const name = r ? (period === 'month' ? r.start.slice(0, 7) : r.start.slice(0, 4)) : ''
  const flagged = anomalies.data?.items ?? []

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label={tr('Period', '周期')} value={period} onChange={(k) => { setPeriod(k); setOffset(0) }}
        options={[['month', tr('Month', '月')], ['year', tr('Year', '年')]] as const} />
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-line w-11 px-0" onClick={() => setOffset(offset - 1)} aria-label={tr('Earlier', '上一期')}>‹</button>
        <span className="num min-w-[5.5rem] text-center font-semibold">{name}</span>
        <button type="button" className="btn btn-line w-11 px-0" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} aria-label={tr('Later', '下一期')}>›</button>
      </div>
    </div>
  )

  return (
    <main tabIndex={-1} className="page-content scope-bills">
      <PageHead title={tr('Spending', '账单')} right={tab === 'overview' ? controls : undefined} />
      <PageTabs label={tr('Spending', '账单')} value={tab} onChange={setTab}
        options={[['overview', tr('Overview', '概览')], ['alerts', flagged.length ? tr(`Worth a look (${flagged.length})`, `需要留意（${flagged.length}）`) : tr('Worth a look', '需要留意')], ['transactions', tr('Transactions', '交易明细')]] as const} />

      {tab === 'overview' && (!r ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : <>
        <div className="stat-grid grid grid-cols-2 gap-4 max-sm:gap-3 lg:grid-cols-4">
          <StatTile icon="wallet" label={tr('Spent', '支出')} value={yuan(r.spend_fen)}
            sub={(r.complete ? '' : tr('So far · ', '截至今天 · ')) + tr(`${r.count} payments`, `${r.count} 笔`)} />
          <StatTile icon="trend" label={tr('Income', '收入')} value={yuan(r.income_fen)} valueClass="text-jade" />
          <StatTile icon="bank" label={tr('Left over', '结余')} value={yuan(r.net_fen)} />
          <StatTile icon="chart" label={period === 'month' ? tr('Vs. last month', '较上月') : tr('Vs. last year', '较去年')}
            value={change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`} valueClass={change === null ? '' : change > 0 ? 'text-cinnabar' : 'text-jade'}
            sub={change === null ? undefined : change > 0 ? tr('more than before', '比上期多花') : tr('less than before', '比上期少花')} />
        </div>

        {flagged.length > 0 && offset === 0 && (
          <Notice tone="alert" className="mt-6" title={tr(`${flagged.length} payments worth a look`, `${flagged.length} 笔交易需要留意`)}
            action={<button type="button" className="btn btn-line bg-[var(--card)] px-4 text-sm" onClick={() => setTab('alerts')}>{tr('Review', '去看看')}</button>}>
            {tr('They don’t look like your usual spending.', '和你平时的消费不太一样。')}
          </Notice>
        )}

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-2">
          <Section title={tr('Where it went', '花在哪了')}>
            <div className="card p-5"><Bars rows={r.categories.map((c) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%`, cat: c.category }))} /></div>
          </Section>
          <Section title={tr('Recent', '最近交易')} aside={<button type="button" className="min-h-10 px-1 text-sm font-semibold text-[var(--action)]" onClick={() => setTab('transactions')}>{tr('All', '全部')}</button>}>
            {!recent.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : <TxnList items={recent.data.items} />}
          </Section>
          <Section title={tr('Top merchants', '花得最多的商户')}>
            <div className="card p-5"><Bars rows={r.top_merchants.map((m) => ({ label: m.merchant, fen: m.fen, hint: m.category ? category(m.category, lang) : undefined, cat: m.category ?? 'other' }))} /></div>
          </Section>
          <Section title={period === 'month' ? tr('Day by day', '每日支出') : tr('Month by month', '每月支出')}>
            {period === 'month'
              ? <SpendCalendar key={r.start} month={r.start} series={r.series} current={!r.complete} />
              : <div className="card p-5"><Columns series={r.series} /></div>}
          </Section>
        </div>
      </>)}

      {tab === 'alerts' && (
        !anomalies.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : !flagged.length ? <p className={EMPTY}>{tr('Nothing unusual in the last 30 days.', '最近 30 天没有异常。')}</p> : <>
          <p className="mb-4 max-w-2xl text-sm text-ink2">{tr('Payments from the last 30 days that don’t look like your usual spending. If you don’t recognise one, freeze the card.', '最近 30 天里和你平时消费不太一样的交易。如果有不认识的，可以先冻结卡片。')}</p>
          <ol className="space-y-3">
            {flagged.map((a) => (
              <li key={`${a.code}-${a.txn_id ?? a.category}`}>
                <Notice tone={a.code === 'CATEGORY_SPIKE' || a.code === 'OVERSEAS_DECLINED' ? 'highlight' : 'alert'}
                  title={<span className="flex flex-wrap items-baseline justify-between gap-x-3"><span>{a.merchant ?? category(a.category ?? 'other', lang)} <span className="ml-1 text-xs font-normal text-ink2">{a.code === 'CATEGORY_SPIKE' ? tr(a.at.slice(0, 7), `${a.at.slice(0, 4)}年${Number(a.at.slice(5, 7))}月`) : a.at.slice(5, 16).replace('T', ' ')}</span></span><span className="num text-ink">{yuan(a.fen)}</span></span>}
                  >
                  {lang === 'zh' ? a.reason_zh : a.reason_en}{a.code === 'DUPLICATE_CHARGE' && tr(' Ask the merchant to refund the second charge.', '可以联系商户退还多扣的那一笔。')}
                  {(a.code === 'NEW_MERCHANT_LARGE' || a.code === 'NIGHT_LARGE') && <div className="mt-2.5"><button type="button" className="btn btn-line bg-[var(--card)] px-4 text-sm text-cinnabar" disabled={!!pending} onClick={() => void send(tr('Freeze the card used for the payment I don’t recognise', '冻结这笔不认识的交易所用的卡'))}>{tr('Freeze card', '冻结卡')}</button></div>}
                  {a.code === 'OVERSEAS_DECLINED' && <div className="mt-2"><Badge tone="grey">{tr('Blocked, not charged', '已拦截，未扣款')}</Badge></div>}
                </Notice>
              </li>
            ))}
          </ol>
        </>
      )}

      {tab === 'transactions' && <Section title={txns.data ? tr(`Last 90 days (${txns.data.count})`, `近 90 天交易（${txns.data.count} 笔）`) : tr('Last 90 days', '近 90 天交易')}
        aside={<label className="flex w-full items-center gap-2 rounded-box border border-rule2 bg-card px-3 py-2 focus-within:border-[var(--action)] focus-within:shadow-[0_0_0_1px_var(--action)] sm:w-60"><Icon name="search" size={16} className="text-ink2" /><input className="min-w-0 w-full bg-transparent text-sm outline-none" autoComplete="off" aria-label={tr('Search transactions', '搜索交易')} placeholder={tr('Search…', '搜索…')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} /></label>}>
        {!txns.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : !txns.data.items.length ? <p className={EMPTY}>{tr('Nothing found.', '没有找到。')}</p> : <>
          <div className={txns.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}><TxnList items={txns.data.items} /></div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3">
            <p className="num text-xs text-ink2" aria-live="polite">{tr(`${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, txns.data.count)} of ${txns.data.count}`, `第 ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, txns.data.count)} 笔，共 ${txns.data.count} 笔`)}</p>
            <Pager page={page} pages={pages} onChange={(n) => { setPage(n); window.scrollTo({ top: 0, behavior: 'smooth' }) }} label={tr('Pages of transactions', '交易分页')} />
          </div>
        </>}
      </Section>}
    </main>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { PageHead, PageTabs, Section, Segmented, useTab } from '../components/bits'
import { Icon } from '../components/Icon'
import { Bars, Columns } from '../components/Results'
import { SealMark } from '../components/Seal'
import { useChat } from '../lib/chat'
import { category, stamp, yuan } from '../lib/format'
import { EMPTY, LIST } from './Accounts'

export default function Bills() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const [tab, setTab] = useTab(['overview', 'alerts', 'transactions'] as const, 'overview')
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const report = useQuery({ queryKey: ['report', period, offset], queryFn: () => api.report(period, offset) })
  const anomalies = useQuery({ queryKey: ['anomalies'], queryFn: api.anomalies })
  const txns = useQuery({ queryKey: ['transactions', 'bills', q], queryFn: () => api.transactions(90, q, 120) })
  const r = report.data
  const change = r && r.previous_spend_fen ? Math.round(((r.spend_fen - r.previous_spend_fen) / r.previous_spend_fen) * 100) : null
  const name = r ? (period === 'month' ? r.start.slice(0, 7) : r.start.slice(0, 4)) : ''
  const flagged = anomalies.data?.items ?? []

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented label={tr('Period', '周期')} value={period} onChange={(k) => { setPeriod(k); setOffset(0) }}
        options={[['month', tr('Month', '月')], ['year', tr('Year', '年')]] as const} />
      <button type="button" className="btn btn-line px-2.5 py-1" onClick={() => setOffset(offset - 1)} aria-label={tr('Earlier', '上一期')}>‹</button>
      <span className="num min-w-[5.5rem] text-center font-mono font-semibold">{name}</span>
      <button type="button" className="btn btn-line px-2.5 py-1" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} aria-label={tr('Later', '下一期')}>›</button>
    </div>
  )

  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Spending', '账单')} right={tab === 'overview' ? controls : undefined} />
      <PageTabs label={tr('Spending', '账单')} value={tab} onChange={setTab}
        options={[['overview', tr('Overview', '概览')], ['alerts', flagged.length ? tr(`Worth a look (${flagged.length})`, `需要留意（${flagged.length}）`) : tr('Worth a look', '需要留意')], ['transactions', tr('Transactions', '交易明细')]] as const} />

      {tab === 'overview' && (!r ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : <>
        <dl className="metric-grid">
          <div className="metric-card"><dt>{tr('Spent', '支出')}{!r.complete && tr(' so far', '（截至今天）')}</dt><dd className="num">{yuan(r.spend_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Income', '收入')}</dt><dd className="num text-jade">{yuan(r.income_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Left over', '结余')}</dt><dd className="num">{yuan(r.net_fen)}</dd></div>
          <div className="metric-card"><dt>{period === 'month' ? tr('Vs. last month', '较上月') : tr('Vs. last year', '较去年')}</dt><dd className={change === null ? '' : change > 0 ? 'text-cinnabar' : 'text-jade'}>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</dd></div>
        </dl>

        <div className="mt-8 grid items-start gap-8 lg:grid-cols-2">
          <Section title={tr('Where it went', '花在哪了')} aside={<span className="text-sm text-ink2">{tr(`${r.count} payments`, `${r.count} 笔`)}</span>}>
            <div className="ruled bg-field p-5"><Bars rows={r.categories.slice(0, 8).map((c) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%` }))} /></div>
          </Section>
          <Section title={tr('Top merchants', '花得最多的商户')}>
            <div className="ruled bg-field p-5"><Bars rows={r.top_merchants.map((m) => ({ label: m.merchant, fen: m.fen }))} /></div>
          </Section>
        </div>

        <Section title={period === 'month' ? tr('Day by day', '每日支出') : tr('Month by month', '每月支出')} className="mt-8">
          <div className="ruled bg-field p-5"><Columns series={r.series} /></div>
        </Section>
      </>)}

      {tab === 'alerts' && (
        !anomalies.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : !flagged.length ? <p className={EMPTY}>{tr('Nothing unusual in the last 30 days.', '最近 30 天没有异常。')}</p> : <>
          <p className="mb-3 max-w-2xl text-sm text-ink2">{tr('Payments from the last 30 days that don’t look like your usual spending. If you don’t recognise one, freeze the card.', '最近 30 天里和你平时消费不太一样的交易。如果有不认识的，可以先冻结卡片。')}</p>
            <ol className={LIST}>
              {flagged.map((a) => (
                <li key={`${a.code}-${a.txn_id ?? a.category}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 px-4 py-3">
                  <SealMark kind="flag" size={28} />
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{a.merchant ?? category(a.category ?? 'other', lang)} <span className="ml-1 font-mono text-xs font-normal text-ink2">{a.at.slice(5, 16).replace('T', ' ')}</span></p>
                    <p className="text-sm leading-snug text-ink2">{lang === 'zh' ? a.reason_zh : a.reason_en}</p>
                  </div>
                  <div className="text-right">
                    <p className="num font-mono">{yuan(a.fen)}</p>
                    {a.code !== 'CATEGORY_SPIKE' && <button type="button" className="mt-1 text-sm font-semibold text-cinnabar" disabled={!!pending} onClick={() => void send(tr('Freeze the card used for the payment I don’t recognise', '冻结这笔不认识的交易所用的卡'))}>{tr('Freeze card', '冻结卡')}</button>}
                  </div>
                </li>
              ))}
            </ol>
        </>
      )}

      {tab === 'transactions' && <Section title={tr('Last 90 days', '近 90 天交易')}
        aside={<label className="flex w-full items-center gap-2 rounded-box border border-rule bg-field px-3 py-1.5 sm:w-60"><Icon name="search" size={16} className="text-ink2" /><input className="min-w-0 w-full bg-transparent text-sm" aria-label={tr('Search transactions', '搜索交易')} placeholder={tr('Search…', '搜索…')} value={q} onChange={(e) => setQ(e.target.value)} /></label>}>
        {!txns.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : !txns.data.items.length ? <p className={EMPTY}>{tr('Nothing found.', '没有找到。')}</p> : (
          <ul className={LIST}>
            {txns.data.items.map((x) => (
              <li key={x.id} className={`flex items-center gap-3 px-4 py-2.5 ${x.status === 'declined' ? 'text-ink2' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{x.merchant}{x.status === 'declined' && <span className="ml-1.5 text-xs font-semibold text-cinnabar">{tr('declined', '已拒绝')}</span>}</p>
                  <p className="text-xs text-ink2">{category(x.category, lang)} · {stamp(x.at)}</p>
                </div>
                <span className={`num shrink-0 font-mono ${x.fen > 0 ? 'text-jade' : ''}`}>{x.fen > 0 ? '+' : ''}{yuan(x.fen)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>}
    </main>
  )
}

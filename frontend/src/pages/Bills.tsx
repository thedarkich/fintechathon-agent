import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bars, CardView, Columns } from '../components/Cards'
import { Empty, Section } from '../components/Chrome'
import { useLang } from '../i18n'
import { call } from '../lib/api'
import { category, shortTime, yuan } from '../lib/format'

interface Report {
  period: string; start: string; end: string; complete: boolean; spend_fen: number; income_fen: number; net_fen: number
  previous_spend_fen: number; categories: { category: string; fen: number; share: number }[]
  top_merchants: { merchant: string; fen: number }[]; series: { label: string; fen: number }[]
}
interface Txn { id: string; at: string; merchant: string; fen: number; category: string; status: string }

export default function Bills() {
  const { tr, lang } = useLang()
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const report = useQuery({ queryKey: ['report', period, offset], queryFn: () => call<Report>(`/api/bank/report?period=${period}&offset=${offset}`) })
  const anomalies = useQuery({ queryKey: ['transactions', 'anomalies'], queryFn: () => call<{ items: unknown[] }>('/api/bank/anomalies') })
  const txns = useQuery({ queryKey: ['transactions', q], queryFn: () => call<{ count: number; items: Txn[] }>(`/api/bank/transactions?days=90&limit=60${q ? `&q=${encodeURIComponent(q)}` : ''}`) })
  const r = report.data
  const change = r && r.previous_spend_fen ? Math.round((r.spend_fen - r.previous_spend_fen) / r.previous_spend_fen * 100) : null
  return (
    <div className="px-4 pb-8 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div role="group" aria-label={tr('Period', '周期')} className="flex rounded-lg border border-rule p-0.5 text-sm font-semibold">
          {([['month', tr('Month', '月')], ['year', tr('Year', '年')]] as const).map(([key, label]) => (
            <button key={key} aria-pressed={period === key} onClick={() => { setPeriod(key); setOffset(0) }} className={`rounded-md px-3 py-1 ${period === key ? 'bg-ink text-sheet' : 'text-ink2'}`}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <button className="btn btn-quiet px-2.5 py-1" onClick={() => setOffset(offset - 1)} aria-label={tr('Earlier', '上一期')}>‹</button>
          <span className="num min-w-[84px] text-center font-semibold">{r ? (period === 'month' ? r.start.slice(0, 7) : r.start.slice(0, 4)) : ''}</span>
          <button className="btn btn-quiet px-2.5 py-1" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} aria-label={tr('Later', '下一期')}>›</button>
        </div>
      </div>
      {r && (
        <>
          <p className="mt-5 text-sm text-ink2">{tr('Spent', '支出')}{!r.complete && tr(' so far', '（截至今天）')}</p>
          <p className="num text-[34px] font-extrabold leading-tight tracking-tight">{yuan(r.spend_fen)}</p>
          <p className="num text-sm text-ink2">
            {tr('Income', '收入')} {yuan(r.income_fen)}, {tr('net', '结余')} {yuan(r.net_fen)}
            {change !== null && <span className={change > 0 ? 'text-vermilion' : 'text-jade'}> · {change > 0 ? '+' : ''}{change}% {tr('vs previous', '较上期')}</span>}
          </p>
          <div className="mt-4 rounded-2xl border border-rule bg-sheet p-4"><Columns series={r.series} lang={lang} /></div>
          <Section title={tr('By category', '分类')}>
            <div className="rounded-2xl border border-rule bg-sheet p-4">
              <Bars rows={r.categories.map((c) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%` }))} />
            </div>
          </Section>
          <Section title={tr('Where it went', '主要去向')}>
            <div className="rounded-2xl border border-rule bg-sheet p-4"><Bars rows={r.top_merchants.map((m) => ({ label: m.merchant, fen: m.fen }))} /></div>
          </Section>
        </>
      )}
      <Section title={tr('Worth a look', '需要留意')}>
        {anomalies.data && (anomalies.data.items.length ? <CardView card={{ type: 'anomalies', items: anomalies.data.items }} /> : <Empty>{tr('Nothing unusual in the last 30 days.', '最近 30 天没有异常交易。')}</Empty>)}
      </Section>
      <Section title={tr('Transactions, last 90 days', '近 90 天交易')}>
        <input className="field mb-2" placeholder={tr('Search merchant or person', '搜索商户或收款人')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr('Search', '搜索')} />
        <ul className="divide-y divide-[var(--rule)] rounded-2xl border border-rule bg-sheet px-4">
          {txns.data?.items.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className={`truncate text-sm ${t.status === 'declined' ? 'text-ink3 line-through' : ''}`}>{t.merchant}</p>
                <p className="text-xs text-ink3">{shortTime(t.at, lang)} {category(t.category, lang)}{t.status === 'declined' ? tr(', declined', '，已拒绝') : ''}</p>
              </div>
              <span className={`num shrink-0 text-sm font-semibold ${t.fen > 0 ? 'text-jade' : ''}`}>{t.fen > 0 ? '+' : ''}{yuan(t.fen)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}

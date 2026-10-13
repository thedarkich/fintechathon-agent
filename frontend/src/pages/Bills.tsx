import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Panel } from '../components/bits'
import { Icon } from '../components/Icon'
import { Bars, Columns } from '../components/Results'
import { SealMark } from '../components/Seal'
import { useChat } from '../lib/chat'
import { category, stamp, yuan } from '../lib/format'

export default function Bills() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const [period, setPeriod] = useState<'month' | 'year'>('month')
  const [offset, setOffset] = useState(0)
  const [q, setQ] = useState('')
  const report = useQuery({ queryKey: ['report', period, offset], queryFn: () => api.report(period, offset) })
  const anomalies = useQuery({ queryKey: ['anomalies'], queryFn: api.anomalies })
  const txns = useQuery({ queryKey: ['transactions', 'bills', q], queryFn: () => api.transactions(90, q, 120) })
  const r = report.data
  const change = r && r.previous_spend_fen ? Math.round(((r.spend_fen - r.previous_spend_fen) / r.previous_spend_fen) * 100) : null
  const name = r ? (period === 'month' ? r.start.slice(0, 7) : r.start.slice(0, 4)) : ''

  return (
    <main tabIndex={-1} className="page-content ">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="cond text-[2.4rem] font-extrabold leading-tight sm:text-[2.9rem]">{tr('Spending', '账单')}</h1>
          <p className="max-w-[38rem] text-ink2">{tr('Where the money went, by category and by merchant, with the transactions worth a second look. Computed by fixed code from your own records.', '钱花到了哪里：按类别、按商户，以及值得留意的交易。全部由固定代码根据你自己的记录计算。')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="tab-scroll flex gap-1" role="tablist" aria-label={tr('Period', '周期')}>
            {([['month', tr('Month', '月')], ['year', tr('Year', '年')]] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={period === k} onClick={() => { setPeriod(k); setOffset(0) }} className={`rounded-box px-3 py-1.5 text-[0.95rem] ${period === k ? 'bg-ink text-field' : 'text-ink hover:bg-paper2'}`}>{label}</button>
            ))}
          </div>
          <button type="button" className="btn btn-line px-2.5 py-1" onClick={() => setOffset(offset - 1)} aria-label={tr('Earlier', '上一期')}>‹</button>
          <span className="num min-w-[5.5rem] text-center font-mono font-semibold">{name}</span>
          <button type="button" className="btn btn-line px-2.5 py-1" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} aria-label={tr('Later', '下一期')}>›</button>
        </div>
      </div>

      {!r ? <div className="mt-7 h-40 animate-pulse rounded-box bg-paper2" /> : <>
        <dl className="metric-grid mt-7">
          <div className="metric-card"><dt>{tr('Spent', '支出')}{!r.complete && tr(' so far', '（截至今天）')}<Icon name="chart" size={17} /></dt><dd className="num">{yuan(r.spend_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Income', '收入')}<Icon name="trend" size={17} /></dt><dd className="num text-jade">{yuan(r.income_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Net', '结余')}<Icon name="wallet" size={17} /></dt><dd className="num">{yuan(r.net_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Against the period before', '较上期')}<Icon name="activity" size={17} /></dt><dd className={change === null ? '' : change > 0 ? 'text-cinnabar' : 'text-jade'}>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</dd></div>
        </dl>
        <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel title={tr('Spending over time', '支出走势')} note={period === 'month' ? tr('Each bar is one day.', '每根柱子是一天。') : tr('Each bar is one month.', '每根柱子是一个月。')}>
            <div className="p-5"><Columns series={r.series} /></div>
          </Panel>
          <Panel title={tr('By category', '分类')} note={tr(`${r.count} payments`, `共 ${r.count} 笔支出`)}>
            <div className="p-5"><Bars rows={r.categories.slice(0, 8).map((c) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%` }))} /></div>
          </Panel>
        </div>
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
          <Panel title={tr('Where it went', '主要去向')}>
            <div className="p-5"><Bars rows={r.top_merchants.map((m) => ({ label: m.merchant, fen: m.fen }))} /></div>
          </Panel>
          <Panel title={tr('Largest single payments', '单笔最大')}>
            <ul className="divide-y divide-rule">
              {r.largest.map((x) => <li key={x.id} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm"><span>{x.merchant}<span className="ml-2 font-mono text-xs text-ink2">{x.at.slice(0, 10)}</span></span><span className="num font-mono">{yuan(x.fen)}</span></li>)}
            </ul>
          </Panel>
        </div>
      </>}

      <div className="mb-4 mt-9 flex items-center gap-2"><Icon name="flag" size={19} /><h2 className="text-lg font-semibold">{tr('Worth a look', '需要留意')}</h2></div>
      {!anomalies.data ? <div className="h-32 animate-pulse rounded-box bg-paper2" /> : anomalies.data.items.length === 0 ? <p className="text-ink2">{tr('Nothing unusual in the last 30 days.', '最近 30 天没有异常交易。')}</p> : (
        <ol className="divide-y divide-rule ruled bg-field">
          {anomalies.data.items.map((a) => (
            <li key={`${a.code}-${a.txn_id ?? a.category}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 px-4 py-3">
              <SealMark kind="flag" size={30} />
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{a.merchant ?? category(a.category ?? 'other', lang)} <span className="ml-1 font-mono text-xs font-normal text-ink2">{a.at.slice(0, 16).replace('T', ' ')}</span></p>
                <p className="text-sm leading-snug text-ink2">{lang === 'zh' ? a.reason_zh : a.reason_en}</p>
              </div>
              <div className="text-right">
                <p className="num font-mono">{yuan(a.fen)}</p>
                {a.code !== 'CATEGORY_SPIKE' && <button type="button" className="mt-1 text-xs text-cinnabar underline decoration-rule underline-offset-4" disabled={!!pending} onClick={() => void send(tr('Freeze the card used for the payment I don’t recognise', '冻结这笔不认识的交易所用的卡'))}>{tr('Freeze that card', '冻结这张卡')}</button>}
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="mb-3 mt-9 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Icon name="activity" size={19} /><h2 className="text-lg font-semibold">{tr('Transactions, last 90 days', '近 90 天交易')}</h2></div>
        <label className="flex w-full items-center gap-2 rounded-box border border-rule bg-field px-3 py-2 sm:w-64"><Icon name="search" size={16} className="text-ink2" /><input className="min-w-0 w-full bg-transparent text-sm" aria-label={tr('Search transactions', '搜索交易')} placeholder={tr('Search merchant or person…', '搜索商户或收款人…')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="overflow-x-auto ruled bg-field">
        <table className="w-full min-w-[40rem] border-collapse text-left text-[0.93rem]">
          <thead><tr className="rule-b bg-paper text-[0.84rem] text-rule2"><th className="px-3 py-2 font-normal">{tr('Time', '时间')}</th><th className="px-3 py-2 font-normal">{tr('Counterparty', '对方')}</th><th className="px-3 py-2 font-normal">{tr('Category', '类别')}</th><th className="px-3 py-2 font-normal">{tr('Channel', '渠道')}</th><th className="px-3 py-2 text-right font-normal">{tr('Amount', '金额')}</th></tr></thead>
          <tbody>
            {txns.data?.items.map((x) => (
              <tr key={x.id} className={`rule-b last:border-b-0 ${x.status === 'declined' ? 'text-ink2' : ''}`}>
                <td className="num px-3 py-2 font-mono text-[0.83rem] text-ink2">{stamp(x.at)}</td>
                <td className="px-3 py-2">{x.merchant}{x.status === 'declined' && <span className="ml-1.5 text-xs font-semibold text-cinnabar">{tr('declined', '已拒绝')}</span>}</td>
                <td className="px-3 py-2 text-ink2">{category(x.category, lang)}</td>
                <td className="px-3 py-2 text-ink2">{x.channel}</td>
                <td className={`num px-3 py-2 text-right font-mono ${x.fen > 0 ? 'text-jade' : ''}`}>{x.fen > 0 ? '+' : ''}{yuan(x.fen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

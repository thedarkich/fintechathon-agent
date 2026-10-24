import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { yuan } from '../lib/format'
import { EMPTY, LoadError } from './bits'
import { TxnList } from './Results'

const WEEK: [string, string][] = [['Mon', '一'], ['Tue', '二'], ['Wed', '三'], ['Thu', '四'], ['Fri', '五'], ['Sat', '六'], ['Sun', '日']]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The day's level on one blue scale: 0 nothing spent, then four steps split at the month's quartiles of spending days. */
function levels(values: number[]) {
  const spent = values.filter((v) => v > 0).sort((a, b) => a - b)
  const at = (p: number) => spent[Math.floor(p * (spent.length - 1))] ?? 0
  const cuts = [at(0.25), at(0.5), at(0.75)]
  return (fen: number) => (fen <= 0 ? 0 : fen <= cuts[0] ? 1 : fen <= cuts[1] ? 2 : fen <= cuts[2] ? 3 : 4)
}

/**
 * A month as a calendar: what was spent on each day, darker for more, and the day's payments under it when a day is
 * tapped. The amounts are the report's own day totals; days still to come are greyed out.
 */
export function SpendCalendar({ month, series, current }: { month: string; series: { label: string; fen: number }[]; current: boolean }) {
  const { tr } = useLang()
  const [year, mon] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))]
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const lead = (new Date(Date.UTC(year, mon - 1, 1)).getUTCDay() + 6) % 7 // weeks start on Monday
  const spent = new Map(series.map((s) => [s.label, s.fen]))
  const level = levels(series.map((s) => s.fen))
  const last = series[series.length - 1]?.label
  const [chosen, setChosen] = useState<string | null>(null)
  // it opens on the latest day with spending, so the list under it starts with something to read
  const day = chosen && spent.has(chosen) ? chosen : [...series].reverse().find((s) => s.fen > 0)?.label ?? last ?? null
  const list = useQuery({ queryKey: ['txn-day', day], queryFn: () => api.searchTransactions({ start: day!, end: day! }, 0, 50), enabled: !!day })
  const label = (d: number) => `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const name = (d: number) => tr(`${MONTHS[mon - 1]} ${d}`, `${mon}月${d}日`)
  const said = (d: number, fen: number | undefined) => fen === undefined ? tr(`${name(d)}: still to come`, `${name(d)}：还没到`)
    : fen ? tr(`${name(d)}: spent ${yuan(fen)}`, `${name(d)}：支出 ${yuan(fen)}`) : tr(`${name(d)}: nothing spent`, `${name(d)}：没有支出`)

  return <>
    <div className="card p-4 sm:p-5">
      <div className="spend-cal-week" aria-hidden>{WEEK.map(([en, zh]) => <span key={en}>{tr(en, zh)}</span>)}</div>
      <div className="spend-cal-grid" role="group" aria-label={tr('Spending by day', '每日支出日历')}>
        {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} aria-hidden />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1
          const fen = spent.get(label(d))
          return (
            <button key={d} type="button" disabled={fen === undefined} aria-pressed={label(d) === day} onClick={() => setChosen(label(d))}
              className={`spend-day lvl-${level(fen ?? 0)} ${current && label(d) === last ? 'is-today' : ''}`} aria-label={said(d, fen)} title={said(d, fen)}>
              <span className="spend-day-n num">{d}</span>
              {!!fen && <span className="spend-day-v num">{Math.round(fen / 100)}</span>}
            </button>
          )
        })}
      </div>
      <p className="spend-cal-legend">
        <span>{tr('Less', '少')}</span>
        {[1, 2, 3, 4].map((n) => <i key={n} className={`lvl-${n}`} aria-hidden />)}
        <span>{tr('More', '多')}</span>
        <span className="ml-auto">{tr('Daily spending in yuan · tap a day', '每日支出（元）· 点日期看明细')}</span>
      </p>
    </div>
    {day && (
      <div className="mt-3">
        <p className="mb-2 flex items-baseline justify-between gap-3 px-1 text-sm">
          <span className="font-semibold">{name(Number(day.slice(8)))}</span>
          <span className="num text-ink2">{spent.get(day) ? tr(`spent ${yuan(spent.get(day)!)}`, `支出 ${yuan(spent.get(day)!)}`) : tr('nothing spent', '没有支出')}
            {list.data ? tr(` · ${list.data.count} transaction${list.data.count === 1 ? '' : 's'}`, ` · ${list.data.count} 笔交易`) : ''}</span>
        </p>
        {list.isError ? <LoadError retry={() => void list.refetch()} />
          : !list.data ? <div className="card h-24 animate-pulse" aria-hidden />
          : list.data.items.length ? <TxnList items={list.data.items} />
          : <p className={EMPTY}>{tr('No transactions that day.', '这一天没有交易。')}</p>}
      </div>
    )}
  </>
}

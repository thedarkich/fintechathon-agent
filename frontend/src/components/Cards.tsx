import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Lock } from 'lucide-react'
import { useLang } from '../i18n'
import { call, errorText, type Card, type PlanResult } from '../lib/api'
import { useChat } from '../lib/chat'
import { category, shortTime, yuan } from '../lib/format'
import { Slip } from './Slip'

/** Simple bars: one row per item, value on the right. Readable on a phone, no chart library. */
export function Bars({ rows, max }: { rows: { label: string; fen: number; hint?: string }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.fen))
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{row.label}{row.hint && <span className="ml-1.5 text-xs text-ink3">{row.hint}</span>}</span>
            <span className="num shrink-0 font-semibold">{yuan(row.fen)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-well"><div className="h-full rounded-full bg-indigo" style={{ width: `${Math.max(2, (row.fen / top) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  )
}

/** A month or year of spending as columns. */
export function Columns({ series, lang }: { series: { label: string; fen: number }[]; lang: 'zh' | 'en' }) {
  const top = Math.max(1, ...series.map((s) => s.fen))
  const monthly = series.length <= 12
  return (
    <figure>
      <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={lang === 'zh' ? '支出走势' : 'Spending over time'}>
        {series.map((s) => (
          <div key={s.label} className="flex-1 rounded-t-sm bg-indigo/80" style={{ height: `${Math.max(2, (s.fen / top) * 100)}%`, backgroundColor: 'var(--indigo)', opacity: s.fen ? 0.85 : 0.2 }} title={`${s.label} ${yuan(s.fen)}`} />
        ))}
      </div>
      <figcaption className="num mt-1 flex justify-between text-[11px] text-ink3">
        <span>{monthly ? series[0]?.label.slice(5) : series[0]?.label.slice(5)}</span>
        <span>{series[series.length - 1]?.label.slice(5)}</span>
      </figcaption>
    </figure>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-rule bg-sheet p-4">{children}</div>
}

function Row({ left, sub, right, tone }: { left: React.ReactNode; sub?: React.ReactNode; right: React.ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className={`truncate text-sm ${tone === 'muted' ? 'text-ink3 line-through' : ''}`}>{left}</p>
        {sub && <p className="text-xs text-ink3">{sub}</p>}
      </div>
      <span className={`num shrink-0 text-sm font-semibold ${tone === 'warn' ? 'text-vermilion' : ''}`}>{right}</span>
    </li>
  )
}

function Ask({ text }: { text: string }) {
  const { send, pending } = useChat()
  return <button type="button" disabled={!!pending} onClick={() => void send(text)} className="rounded-full border border-rule bg-sheet px-3 py-1 text-xs font-semibold text-indigo hover:border-indigo">{text}</button>
}

function Question({ card }: { card: Card }) {
  const { lang, tr } = useLang()
  const { apply } = useChat()
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState<number[]>([])
  const choose = async (value: unknown) => {
    setError('')
    try {
      apply(await call<PlanResult>(`/api/plans/${card.plan_id}/answer`, { value, lang }))
    } catch (err) {
      setError(errorText(err, lang))
    }
  }
  if (card.field === 'answers') {
    return (
      <Panel>
        <ol className="space-y-4">
          {card.options.map((q: { question_zh: string; question_en: string; choices_zh: string[]; choices_en: string[] }, i: number) => (
            <li key={i}>
              <p className="text-sm font-semibold">{i + 1}. {lang === 'zh' ? q.question_zh : q.question_en}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {(lang === 'zh' ? q.choices_zh : q.choices_en).map((choice, j) => (
                  <button key={choice} type="button" aria-pressed={answers[i] === j + 1} onClick={() => { const next = [...answers]; next[i] = j + 1; setAnswers(next) }}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${answers[i] === j + 1 ? 'border-indigo bg-indigo-wash text-indigo' : 'border-rule text-ink2'}`}>{choice}</button>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <button className="btn btn-primary mt-4 w-full" disabled={answers.filter(Boolean).length < card.options.length} onClick={() => void choose(answers)}>{tr('Submit answers', '提交答案')}</button>
        {error && <p className="mt-2 text-sm text-vermilion">{error}</p>}
      </Panel>
    )
  }
  if (!card.options?.length) return null
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {card.options.map((o: { value: string; label_zh: string; label_en: string }) => (
          <button key={String(o.value)} type="button" onClick={() => void choose(o.value)} className="rounded-xl border border-rule bg-sheet px-3 py-2 text-left text-sm hover:border-indigo">
            {lang === 'zh' ? o.label_zh : o.label_en}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-vermilion">{error}</p>}
    </div>
  )
}

export function CardView({ card }: { card: Card }) {
  const { lang, tr } = useLang()
  const navigate = useNavigate()
  switch (card.type) {
    case 'approval':
      return <Slip planId={card.plan_id} />
    case 'question':
      return <Question card={card} />
    case 'lock':
      return (
        <div className="flex items-center gap-3 rounded-2xl border border-vermilion bg-vermilion-wash p-3 text-sm text-vermilion">
          <Lock size={18} className="shrink-0" />
          <span className="flex-1">{tr('Verify your identity to resume the assistant.', '完成身份验证即可恢复助手。')}</span>
          <button className="btn btn-danger" onClick={() => navigate('/more#security')}>{tr('Verify', '去验证')}</button>
        </div>
      )
    case 'receipt':
      return (
        <div className="slip tier-green settle">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-jade"><CheckCircle2 size={16} />{tr('Done', '已完成')}</p>
          <p className="num mt-1 text-2xl font-bold">{yuan(card.fen)}</p>
          {card.balance_fen !== undefined && <p className="num text-xs text-ink3">{tr('Balance after', '交易后余额')} {yuan(card.balance_fen)}</p>}
        </div>
      )
    case 'balances':
      return (
        <Panel>
          <ul className="divide-y divide-[var(--rule)]">
            {card.accounts.map((a: { id: string; name: string; number: string; fen: number }) => <Row key={a.id} left={a.name} sub={a.number} right={yuan(a.fen)} />)}
          </ul>
        </Panel>
      )
    case 'transactions':
      return (
        <Panel>
          <ul className="divide-y divide-[var(--rule)]">
            {card.items.map((t: { id: string; at: string; merchant: string; fen: number; status: string; category: string }) => (
              <Row key={t.id} left={t.merchant} sub={`${shortTime(t.at, lang)} ${category(t.category, lang)}${t.status === 'declined' ? tr(', declined', '，已拒绝') : ''}`}
                right={yuan(t.fen)} tone={t.status === 'declined' ? 'muted' : undefined} />
            ))}
          </ul>
        </Panel>
      )
    case 'spending':
      return <Panel><Bars rows={card.categories.slice(0, 8).map((c: { category: string; fen: number; share: number }) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%` }))} /></Panel>
    case 'report':
      return (
        <Panel>
          <Columns series={card.series} lang={lang} />
          <div className="mt-4"><Bars rows={card.categories.slice(0, 6).map((c: { category: string; fen: number; share: number }) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%` }))} /></div>
        </Panel>
      )
    case 'anomalies':
      return (
        <div className="space-y-2">
          {card.items.map((a: { txn_id: string | null; at: string; merchant: string | null; fen: number; reason_zh: string; reason_en: string; code: string; category?: string }) => (
            <div key={`${a.code}-${a.txn_id ?? a.category}`} className="slip tier-red">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-semibold">{a.merchant ?? category(a.category ?? 'other', lang)}</p>
                <p className="num shrink-0 font-bold">{yuan(a.fen)}</p>
              </div>
              <p className="mt-0.5 text-xs text-ink3">{a.at.slice(0, 16).replace('T', ' ')}</p>
              <p className="mt-1.5 text-sm">{lang === 'zh' ? a.reason_zh : a.reason_en}</p>
              {a.code !== 'CATEGORY_SPIKE' && <div className="mt-2 flex flex-wrap gap-2"><Ask text={tr('Freeze the card it used', '冻结这笔交易用的卡')} /></div>}
            </div>
          ))}
        </div>
      )
    case 'subscriptions':
      return (
        <Panel>
          <p className="text-sm text-ink2">{tr('About', '约合每月')} <span className="num font-bold text-ink">{yuan(card.monthly_fen)}</span>{tr(' a month', '')}</p>
          <ul className="mt-2 divide-y divide-[var(--rule)]">
            {card.items.map((s: { id: string; merchant: string; fen: number; cycle: string; status: string; next_charge_on: string; new: boolean }) => (
              <Row key={s.id} left={s.merchant} tone={s.status === 'cancelled' ? 'muted' : undefined}
                sub={`${s.cycle === 'monthly' ? tr('monthly', '每月') : tr('yearly', '每年')} · ${tr('next', '下次')} ${s.next_charge_on}${s.new ? tr(' · started recently', ' · 近期开通') : ''}`}
                right={yuan(s.fen)} />
            ))}
          </ul>
          {card.overlaps.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{card.overlaps.flatMap((o: { merchants: string[] }) => o.merchants.slice(1).map((m) => <Ask key={m} text={tr(`Cancel ${m}`, `取消${m}`)} />))}</div>}
        </Panel>
      )
    case 'cards':
      return (
        <Panel>
          <ul className="divide-y divide-[var(--rule)]">
            {card.items.map((c: { id: string; name: string; last4: string; status: string; daily_limit_fen: number }) => (
              <Row key={c.id} left={`${c.name} ****${c.last4}`} sub={`${tr('Daily limit', '日限额')} ${yuan(c.daily_limit_fen)}`} right={c.status} />
            ))}
          </ul>
        </Panel>
      )
    case 'holdings':
      return (
        <Panel>
          <ul className="divide-y divide-[var(--rule)]">
            {card.items.map((h: { code: string; name: string; value_fen: number; gain_fen: number; return_pct: number }) => (
              <Row key={h.code} left={h.name} sub={`${tr('Gain', '收益')} ${yuan(h.gain_fen)} (${h.return_pct > 0 ? '+' : ''}${h.return_pct}%)`} right={yuan(h.value_fen)} />
            ))}
          </ul>
        </Panel>
      )
    case 'products':
    case 'compare':
      return (
        <Panel>
          <ul className="divide-y divide-[var(--rule)]">
            {card.items.map((p: { code: string; name: string; risk_level: number; yield_bp: number; return_1y_bp: number; max_drawdown_bp: number; suitable: boolean }) => (
              <Row key={p.code} left={`${p.name} · R${p.risk_level}`} tone={p.suitable ? undefined : 'warn'}
                sub={p.yield_bp ? `${tr('7-day annualised', '七日年化')} ${(p.yield_bp / 100).toFixed(2)}%` : `${tr('1 year', '近一年')} ${(p.return_1y_bp / 100).toFixed(2)}% · ${tr('max drawdown', '最大回撤')} ${(p.max_drawdown_bp / 100).toFixed(2)}%`}
                right={p.suitable ? tr('Suitable', '适合') : tr('Above your level', '超出等级')} />
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink3">{tr('Simulated demo products, not investment advice.', '模拟产品，仅用于演示，不构成投资建议。')}</p>
        </Panel>
      )
    default:
      return null
  }
}

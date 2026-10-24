import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { Card, TxnQuery } from '../api/types'
import { useLang } from '../i18n'
import { useChat } from '../lib/chat'
import { category, categoryColor, stamp, yuan } from '../lib/format'
import { CategoryIcon } from './Icon'
import { Badge, LIST, LoadError, Pager } from './bits'
import { ConfirmCard } from './PlanView'
import { SealMark } from './Seal'

/** A ruled table in the ledger's style. */
export function Table({ head, children, minWidth = '30rem' }: { head: ReactNode[]; children: ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto card">
      <table className="w-full border-collapse text-left text-body" style={{ minWidth }}>
        <thead>
          <tr className="rule-b bg-paper text-cap font-semibold text-ink2">
            {head.map((h, i) => <th key={i} className={`px-3 py-2 font-normal ${i === head.length - 1 ? 'text-right' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

type Row = { key: string; lead?: ReactNode; main: ReactNode; sub?: ReactNode; value?: ReactNode; muted?: boolean }

/** A list of rows as on the app's pages: what it is, a grey detail line, the amount on the right. */
function Rows({ items }: { items: Row[] }) {
  return (
    <ul className="divide-y divide-[var(--rule)] card">
      {items.map((row) => (
        <li key={row.key} className={`flex items-center gap-3 px-3 py-2.5 ${row.muted ? 'text-ink2' : ''}`}>
          {row.lead}
          <div className="min-w-0 flex-1">
            <p className="truncate text-body">{row.main}</p>
            {row.sub && <p className="text-xs text-ink2">{row.sub}</p>}
          </div>
          {row.value !== undefined && <span className="num shrink-0 font-semibold">{row.value}</span>}
        </li>
      ))}
    </ul>
  )
}

type Txn = Awaited<ReturnType<typeof api.transactions>>['items'][number]

/** Transactions as on the bank's pages: the category's badge, merchant, category and time, the amount on the right. */
export function TxnList({ items, hidden = false }: { items: Txn[]; hidden?: boolean }) {
  const { tr, lang } = useLang()
  return (
    <ul className={LIST}>
      {items.map((x) => (
        <li key={x.id} className={`flex items-center gap-3 px-4 py-3 ${x.status === 'declined' ? 'text-ink2' : ''}`}>
          <CategoryIcon code={x.category} size="1rem" badge />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{x.merchant}{x.status === 'declined' && <Badge tone="red" className="ml-2">{tr('declined', '已拒绝')}</Badge>}</p>
            <p className="text-xs text-ink2">{category(x.category, lang)} · {stamp(x.at)}</p>
          </div>
          <span className={`num shrink-0 font-semibold ${x.fen > 0 ? 'text-jade' : ''}`}>{hidden ? '¥ ••••' : `${x.fen > 0 ? '+' : ''}${yuan(x.fen)}`}</span>
        </li>
      ))}
    </ul>
  )
}

export function Bars({ rows }: { rows: { label: string; fen: number; hint?: string; cat?: string }[] }) {
  const top = Math.max(1, ...rows.map((r) => r.fen))
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {row.cat && <CategoryIcon code={row.cat} />}
              <span className="truncate">{row.label}{row.hint && <span className="ml-1.5 text-xs text-ink2">{row.hint}</span>}</span>
            </span>
            <span className="num shrink-0 font-semibold">{yuan(row.fen)}</span>
          </div>
          <div className="budget-track"><span style={{ width: `${Math.max(2, (row.fen / top) * 100)}%`, ...(row.cat ? { background: categoryColor(row.cat) } : {}) }} /></div>
        </li>
      ))}
    </ul>
  )
}

export function Columns({ series }: { series: { label: string; fen: number }[] }) {
  const { tr } = useLang()
  const top = Math.max(1, ...series.map((s) => s.fen))
  return (
    <figure>
      <div className="flex h-32 items-end gap-[3px]" role="img" aria-label={tr('Spending over time', '支出走势')}>
        {series.map((s) => (
          <div key={s.label} className="flex-1 rounded-t-[2px]" style={{ height: `${Math.max(2, (s.fen / top) * 100)}%`, background: 'var(--scope)', opacity: s.fen ? 0.85 : 0.18 }} title={`${s.label} ${yuan(s.fen)}`} />
        ))}
      </div>
      <figcaption className="num mt-1 flex justify-between text-xs text-ink2">
        <span>{series[0]?.label.slice(5)}</span>
        <span>{series[series.length - 1]?.label.slice(5)}</span>
      </figcaption>
    </figure>
  )
}

/** Transactions as the assistant's rows: badge, merchant, category and time, the amount. */
function txnRows(items: Txn[], tr: (en: string, zh: string) => string, lang: 'zh' | 'en'): Row[] {
  return items.map((x) => ({
    key: x.id, muted: x.status === 'declined', lead: <CategoryIcon code={x.category} size="1rem" badge />,
    main: <>{x.merchant}{x.status === 'declined' && <span className="ml-1.5 text-xs text-cinnabar">{tr('declined', '已拒绝')}</span>}</>,
    sub: `${category(x.category, lang)} · ${stamp(x.at)}`,
    value: <span className={x.fen > 0 ? 'text-jade' : ''}>{x.fen > 0 ? '+' : ''}{yuan(x.fen)}</span>,
  }))
}

/**
 * The assistant's transactions card: every match, ten to a page. The first page came with the answer; later ones are
 * the same search, run again by the bank for this customer when the page is turned.
 */
function TxnPages({ card }: { card: Card }) {
  const { tr, lang } = useLang()
  const [page, setPage] = useState(1)
  const query: TxnQuery | undefined = card.query
  const size: number = card.page_size ?? 10
  const pages = query ? Math.max(1, Math.ceil(card.count / size)) : 1
  const later = useQuery({
    queryKey: ['txn-search', query, page, size], queryFn: () => api.searchTransactions(query!, (page - 1) * size, size),
    enabled: !!query && page > 1, placeholderData: keepPreviousData,
  })
  const items: Txn[] = page === 1 ? card.items : later.data?.items ?? []
  const from = (page - 1) * size + 1
  const to = Math.min(page * size, card.count)
  return (
    <div className="space-y-1">
      {page > 1 && later.isError ? <LoadError retry={() => void later.refetch()} />
        : page > 1 && !later.data ? <div className="card h-40 animate-pulse" aria-hidden />
        : <div className={later.isPlaceholderData && page > 1 ? 'opacity-60 transition-opacity' : ''}><Rows items={txnRows(items, tr, lang)} /></div>}
      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3">
          <p className="num text-xs text-ink2" aria-live="polite">{tr(`${from}–${to} of ${card.count}`, `第 ${from}–${to} 笔，共 ${card.count} 笔`)}</p>
          <Pager page={page} pages={pages} onChange={setPage} label={tr('Pages of transactions', '交易分页')} />
        </div>
      )}
    </div>
  )
}

/** An analysis answer's rows, all of them, ten to a page. */
function AnalysisRows({ rows, show }: { rows: [string, number][]; show: (v: number) => string }) {
  const { tr } = useLang()
  const [page, setPage] = useState(1)
  const size = 10
  const pages = Math.ceil(rows.length / size)
  return <>
    <ul className="mt-3 divide-y divide-rule">
      {rows.slice((page - 1) * size, page * size).map(([label, value]) => <li key={label} className="flex justify-between py-1.5 text-sm"><span className="num text-ink2">{label}</span><span className="num font-semibold">{show(value)}</span></li>)}
    </ul>
    <Pager page={page} pages={pages} onChange={setPage} label={tr('Pages of rows', '明细分页')} />
  </>
}

function Ask({ text }: { text: string }) {
  const { send, pending } = useChat()
  return <button type="button" disabled={!!pending} onClick={() => void send(text)} className="btn btn-line py-1 text-cap">{text}</button>
}

function Question({ card }: { card: Card }) {
  const { lang, tr } = useLang()
  const { apply } = useChat()
  const [error, setError] = useState('')
  const [answers, setAnswers] = useState<number[]>([])
  const choose = async (value: unknown) => {
    setError('')
    try {
      apply(await api.answer(card.plan_id, value, lang))
    } catch (err) {
      setError(errorText(err, lang))
    }
  }
  if (card.field === 'answers') {
    return (
      <div className="card p-4">
        <ol className="space-y-4">
          {card.options.map((q: { question_zh: string; question_en: string; choices_zh: string[]; choices_en: string[] }, i: number) => (
            <li key={i}>
              <p className="text-sm font-semibold">{i + 1}. {lang === 'zh' ? q.question_zh : q.question_en}</p>
              <div className="demo-options !my-2">
                {(lang === 'zh' ? q.choices_zh : q.choices_en).map((choice, j) => (
                  <button key={choice} type="button" aria-pressed={answers[i] === j + 1} onClick={() => { const next = [...answers]; next[i] = j + 1; setAnswers(next) }}>{choice}</button>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <button className="btn btn-ink mt-2 w-full py-2" disabled={answers.filter(Boolean).length < card.options.length} onClick={() => void choose(answers)}>{tr('Submit answers', '提交答案')}</button>
        {error && <p className="mt-2 text-sm text-cinnabar">{error}</p>}
      </div>
    )
  }
  if (!card.options?.length) return null
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {card.options.map((o: { value: string; label_zh: string; label_en: string }) => (
          <button key={String(o.value)} type="button" onClick={() => void choose(o.value)} className="btn btn-line py-1.5 text-left text-body">
            {lang === 'zh' ? o.label_zh : o.label_en}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-cinnabar">{error}</p>}
    </div>
  )
}

/** Buy a suggested product: the request goes through the chat, so the rules and the PIN apply as always. */
function BuyButton({ name }: { name: string }) {
  const { tr } = useLang()
  const { send, pending } = useChat()
  return <button type="button" className="btn btn-ink px-4 text-sm" disabled={!!pending} onClick={() => void send(tr(`Buy 5000 of ${name}`, `申购${name}5000元`))}>{tr('Buy ¥5,000', '申购 ¥5,000')}</button>
}

export function Result({ card }: { card: Card }) {
  const { lang, tr } = useLang()
  const navigate = useNavigate()
  switch (card.type) {
    case 'approval':
      return <ConfirmCard planId={card.plan_id} />
    case 'question':
      return <Question card={card} />
    case 'lock':
      return (
        <div className="flex flex-wrap items-center gap-3 rounded-tile bg-[var(--cinnabar-wash)] px-4 py-3 text-sm">
          <span className="flex-1">{tr('The assistant is paused by a safety lock. Verify your identity to resume.', '助手已被安全锁暂停，完成身份验证即可恢复。')}</span>
          <button className="btn btn-cinnabar py-1.5" onClick={() => navigate('/controls?tab=security')}>{tr('Verify', '去验证')}</button>
        </div>
      )
    case 'receipt':
      return (
        <div className="flex items-center gap-3 card px-3 py-2.5">
          <SealMark kind="done" size={30} />
          <div><p className="font-semibold text-jade">{tr('Done', '已办成')} <span className="num font-semibold text-ink">{yuan(card.fen)}</span></p>
            {card.balance_fen !== undefined && <p className="num text-cap text-ink2">{tr('Balance after', '交易后余额')} {yuan(card.balance_fen)}</p>}</div>
        </div>
      )
    case 'balances':
      return (
        <Rows items={card.accounts.map((a: { id: string; name: string; number: string; fen: number }) => ({
          key: a.id, main: <>{a.name} <span className="font-mono text-cap text-ink2">{a.number.slice(-4)}</span></>, value: yuan(a.fen),
        }))} />
      )
    case 'transactions':
      return <TxnPages card={card} />
    case 'spending':
      return <div className="card p-4"><Bars rows={card.categories.map((c: { category: string; fen: number; share: number }) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%`, cat: c.category }))} /></div>
    case 'report':
      return (
        <div className="card p-4">
          <Columns series={card.series} />
          <div className="mt-4"><Bars rows={card.categories.map((c: { category: string; fen: number; share: number }) => ({ label: category(c.category, lang), fen: c.fen, hint: `${Math.round(c.share * 100)}%`, cat: c.category }))} /></div>
        </div>
      )
    case 'anomalies':
      return (
        <ol className="divide-y divide-rule card">
          {card.items.map((a: { txn_id: string | null; at: string; merchant: string | null; fen: number; reason_zh: string; reason_en: string; code: string; category?: string }) => (
            <li key={`${a.code}-${a.txn_id ?? a.category}`} className="grid grid-cols-[auto_1fr_auto] gap-x-3 px-3 py-2.5">
              <SealMark kind="flag" size={28} />
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{a.merchant ?? category(a.category ?? 'other', lang)}</p>
                <p className="text-cap leading-snug text-ink2">{lang === 'zh' ? a.reason_zh : a.reason_en}</p>
                {a.code !== 'CATEGORY_SPIKE' && <div className="mt-1.5"><Ask text={tr('Freeze the card it used', '冻结这笔交易用的卡')} /></div>}
              </div>
              <div className="text-right"><p className="num font-semibold">{yuan(a.fen)}</p><p className="text-xs text-ink2">{a.at.slice(0, 10)}</p></div>
            </li>
          ))}
        </ol>
      )
    case 'subscriptions':
      return (
        <div className="space-y-2">
          <Rows items={card.items.filter((s: { status: string }) => s.status === 'active').map((s: { id: string; merchant: string; fen: number; cycle: string; next_charge_on: string; new: boolean }) => ({
            key: s.id,
            main: <>{s.merchant}{s.new && <span className="ml-1.5 text-xs text-cinnabar">{tr('new', '近期开通')}</span>}</>,
            sub: `${s.cycle === 'monthly' ? tr('monthly', '每月') : tr('yearly', '每年')} · ${tr('next', '下次')} ${s.next_charge_on}`,
            value: yuan(s.fen),
          }))} />
          {card.overlaps.length > 0 && <div className="flex flex-wrap gap-2">{card.overlaps.flatMap((o: { merchants: string[] }) => o.merchants.slice(1).map((m) => <Ask key={m} text={tr(`Cancel ${m}`, `取消${m}`)} />))}</div>}
        </div>
      )
    case 'cards':
      return (
        <Rows items={card.items.map((c: { id: string; name: string; last4: string; status: string; daily_limit_fen: number }) => ({
          key: c.id, main: <>{c.name} <span className="font-mono text-cap text-ink2">{c.last4}</span></>,
          sub: tr(`daily limit ${yuan(c.daily_limit_fen)}`, `日限额 ${yuan(c.daily_limit_fen)}`),
          value: <span className={`font-sans font-semibold ${c.status === 'active' ? 'text-jade' : 'text-cinnabar'}`}>{({ active: tr('Active', '正常'), frozen: tr('Frozen', '已冻结'), lost: tr('Reported lost', '已挂失') } as Record<string, string>)[c.status] ?? c.status}</span>,
        }))} />
      )
    case 'holdings':
      return (
        <Rows items={card.items.map((h: { code: string; name: string; value_fen: number; gain_fen: number; return_pct: number }) => ({
          key: h.code, main: h.name,
          sub: <span className="text-jade">{tr('gain', '收益')} {yuan(h.gain_fen)} ({h.return_pct > 0 ? '+' : ''}{h.return_pct}%)</span>,
          value: yuan(h.value_fen),
        }))} />
      )
    case 'compare': {
      // side by side, one column per product; every figure and the conclusion come from the bank
      type P = { code: string; name: string; kind: string; risk_level: number; yield_bp: number; return_1y_bp: number; max_drawdown_bp: number; min_fen: number; redeem_days: number; fee_bp: number; suitable: boolean }
      const items = card.items as P[]
      const pct = (v: number) => `${(v / 100).toFixed(2)}%`
      const kinds: Record<string, [string, string]> = { money_market: ['Money market', '货币基金'], bond: ['Bond', '债券基金'], mixed: ['Mixed', '混合基金'], equity: ['Equity', '股票基金'], qdii: ['QDII', 'QDII 基金'] }
      const rows: [string, (p: P) => ReactNode][] = [
        [tr('Type', '类型'), (p) => (kinds[p.kind] ? tr(...kinds[p.kind]) : p.kind)],
        [tr('Risk', '风险等级'), (p) => `R${p.risk_level}`],
        [tr('Return', '收益'), (p) => (p.yield_bp ? `${tr('7-day', '七日年化')} ${pct(p.yield_bp)}` : `${tr('1 year', '近一年')} ${pct(p.return_1y_bp)}`)],
        [tr('Worst fall', '最大回撤'), (p) => (p.max_drawdown_bp ? pct(p.max_drawdown_bp) : '—')],
        [tr('Minimum', '起购'), (p) => yuan(p.min_fen)],
        [tr('Redemption', '赎回到账'), (p) => `T+${p.redeem_days}`],
        [tr('Fee', '费率'), (p) => pct(p.fee_bp)],
        [tr('For you', '是否适合你'), (p) => (p.suitable ? <BuyButton name={p.name} /> : <span className="text-sm font-semibold text-cinnabar">{tr('Above your level', '超出等级')}</span>)],
      ]
      const safer = items.find((p) => p.code === card.safer)
      return (
        <div className="space-y-1.5">
          <Table head={['', ...items.map((p) => p.name)]} minWidth={`${10 + items.length * 9}rem`}>
            {rows.map(([label, value]) => (
              <tr key={label} className="rule-b last:border-b-0">
                <td className="px-3 py-1.5 text-ink2">{label}</td>
                {items.map((p, i) => <td key={p.code} className={`num px-3 py-1.5 font-semibold ${i === items.length - 1 ? 'text-right' : ''}`}>{value(p)}</td>)}
              </tr>
            ))}
          </Table>
          {safer && <p className="text-sm">{tr(`Lower risk: ${safer.name}. Higher returns usually come with larger swings.`, `风险更低的是 ${safer.name}；收益更高的产品通常波动也更大。`)}</p>}
          <p className="text-xs text-ink2">{tr('Simulated products. Not investment advice.', '模拟产品，不构成投资建议。')}</p>
        </div>
      )
    }
    case 'products':
      return (
        <div className="space-y-1.5">
          <Rows items={card.items.map((p: { code: string; name: string; risk_level: number; yield_bp: number; return_1y_bp: number; suitable: boolean }) => ({
            key: p.code, main: p.name,
            sub: `R${p.risk_level} · ${p.yield_bp ? `${tr('7-day', '七日年化')} ${(p.yield_bp / 100).toFixed(2)}%` : `${tr('1 year', '近一年')} ${(p.return_1y_bp / 100).toFixed(2)}%`}`,
            value: p.suitable ? <BuyButton name={p.name} /> : <span className="text-sm font-semibold text-cinnabar">{tr('Above your level', '超出等级')}</span>,
          }))} />
          <p className="text-xs text-ink2">{tr('Simulated products. Not investment advice.', '模拟产品，不构成投资建议。')}</p>
        </div>
      )
    case 'receipt_reading':
      return card.reading.is_receipt ? (
        <div className="space-y-1.5">
          <Table head={[card.reading.merchant, yuan(card.reading.total_fen)]} minWidth="18rem">
            {card.reading.items.slice(0, 12).map((item: { name: string; fen: number }, i: number) => (
              <tr key={i} className="rule-b last:border-b-0"><td className="px-3 py-1.5">{item.name}</td><td className="num px-3 py-1.5 text-right font-semibold">{yuan(item.fen)}</td></tr>
            ))}
          </Table>
          {card.flags.length > 0 && <p className="border-l-2 border-cinnabar pl-2.5 text-sm text-cinnabar">{tr('Hidden text or instructions were found in this file and ignored.', '文件中发现隐藏文字或指令，已忽略。')}</p>}
          <p className="text-xs text-ink2">{card.read_by === 'rules' ? tr('Read from the PDF text by fixed rules.', '由固定规则从 PDF 文字读取。') : tr('Read by the AI model into a fixed format.', '由 AI 模型按固定格式读取。')}</p>
        </div>
      ) : null
    case 'analysis': {
      const show = (v: number) => (card.unit === 'count' ? tr(`${v} times`, `${v} 次`) : card.unit === 'percent' ? `${v}%` : yuan(Math.round(v * 100)))
      return (
        <div className="space-y-2">
          <div className="card p-4">
            <p className="text-sm text-ink2">{card.title}</p>
            {card.value !== null && <p className="num cond mt-1 text-[1.8rem] font-semibold leading-none">{show(card.value)}</p>}
            {card.rows.length > 0 && <AnalysisRows rows={card.rows} show={show} />}
            {card.rows.length > 0 && card.rows.every(([label]: [string, number]) => /^\d{4}-\d{2}$/.test(label)) && (
              <p className="mt-2 text-xs text-ink2">{tr('Only months with any are listed.', '只列出有记录的月份。')}</p>
            )}
          </div>
          <details className="agent-detail !mt-0">
            <summary className="fold inline-flex items-center gap-1">{tr('The generated code and the sandbox limits', '生成的代码与沙箱限制')}<ChevronDown size={14} aria-hidden /></summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-box bg-[#0f1114] p-3 font-code text-xs leading-relaxed text-[#eef6f1]">{card.code}</pre>
            <p>
              {tr(`Ran in ${card.ms} ms in a separate process: ${card.limits.memory_mb} MB memory, ${card.limits.cpu_seconds} s CPU, no files, imports limited to ${card.limits.imports.join(', ')}.`,
                `在独立进程中运行 ${card.ms} 毫秒：内存 ${card.limits.memory_mb} MB，CPU ${card.limits.cpu_seconds} 秒，不能读写文件，仅允许导入 ${card.limits.imports.join('、')}。`)}
            </p>
          </details>
        </div>
      )
    }
    default:
      return null
  }
}

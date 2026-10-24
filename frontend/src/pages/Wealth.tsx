import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Badge, EMPTY, IconDot, LIST, LoadError, PageHead, RatingPills, Section, StatTile } from '../components/bits'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'

const LEVEL: Record<number, [string, string]> = { 1: ['保守型 C1', 'Conservative C1'], 2: ['稳健型 C2', 'Cautious C2'], 3: ['平衡型 C3', 'Balanced C3'], 4: ['成长型 C4', 'Growth C4'], 5: ['进取型 C5', 'Aggressive C5'] }
const KIND: Record<string, [string, string]> = { money_market: ['货币基金', 'Money market'], bond: ['债券基金', 'Bond'], mixed: ['混合基金', 'Mixed'], equity: ['股票基金', 'Equity'], qdii: ['QDII 基金', 'QDII'] }

/** A product's risk, R1–R5, as five pills: green while it stays low, amber above. */
function Risk({ level }: { level: number }) {
  const { tr } = useLang()
  return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ink2">{tr('Risk', '风险')} <RatingPills value={level} tone={level <= 2 ? 'scope' : 'amber'} label={tr('Risk level', '风险等级')} showValue={false} /><b className="num text-ink">R{level}</b></span>
}

/** Card 03, wealth operations: what you hold, your risk level, and the products you may buy. */
export default function Wealth() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const wealth = useQuery({ queryKey: ['wealth', lang], queryFn: () => api.wealth(lang) })
  const d = wealth.data
  const ask = (text: string) => void send(text)
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`
  // products ticked for a side-by-side comparison (the brief's “recommendation and comparison”)
  const [picked, setPicked] = useState<string[]>([])
  const pick = (name: string) => setPicked((all) => all.includes(name) ? all.filter((n) => n !== name) : [...all, name].slice(-4))
  return (
    <main tabIndex={-1} className="page-content scope-wealth">
      <PageHead title={tr('Invest', '理财')}
        right={<button type="button" className="btn btn-ink px-5" disabled={!!pending} onClick={() => ask(tr('Recommend a low-risk product', '推荐一个稳健的理财'))}>{tr('Get a suggestion', '让助手推荐')}</button>} />
      {!d ? (wealth.isError ? <LoadError retry={() => void wealth.refetch()} /> : <div className="h-64 animate-pulse rounded-box bg-paper2" />) : <>
        <div className="stat-grid grid gap-4 max-sm:gap-3 sm:grid-cols-3">
          <StatTile icon="wallet" label={tr('Market value', '持仓市值')} value={yuan(d.holdings.value_fen)} sub={tr(`${d.holdings.items.length} holdings`, `${d.holdings.items.length} 只产品`)} />
          <StatTile icon="trend" label={tr('Total gain', '累计收益')} value={`${d.holdings.gain_fen > 0 ? '+' : ''}${yuan(d.holdings.gain_fen)}`} valueClass="text-jade" />
          <div className="card min-w-0 p-5 max-sm:p-4">
            <div className="flex items-center gap-3">
              <IconDot icon="shield" size={40} />
              <span className="stat-label min-w-0 flex-1">{tr('Your risk level', '你的风险等级')}</span>
              <button type="button" className="min-h-10 px-1 text-sm font-semibold text-[var(--action)]" disabled={!!pending} onClick={() => ask(tr('Redo my risk assessment', '重新做风险测评'))}>{tr('Redo', '重新测评')}</button>
            </div>
            {d.profile ? <>
              <p className="stat-value mt-3">{LEVEL[d.profile.level][lang === 'zh' ? 0 : 1]}</p>
              <div className="mt-2"><RatingPills value={d.profile.level} label={tr('Risk level', '风险等级')} /></div>
            </> : <p className="stat-value mt-3">{tr('Not assessed', '未测评')}</p>}
          </div>
        </div>

        <Section title={tr('Holdings', '持仓')} className="mt-8">
          {!d.holdings.items.length ? <p className={EMPTY}>{tr('No holdings.', '没有持仓。')}</p> : (
            <ul className={LIST}>
              {d.holdings.items.map((h) => (
                <li key={h.code} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <div className="col-span-2 min-w-0 sm:col-span-1">
                    <p className="font-semibold">{h.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink2"><Risk level={h.risk_level} />{tr(`since ${h.since}`, `${h.since} 起`)}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="num font-semibold">{yuan(h.value_fen)}</p>
                    <p className="num text-xs font-semibold text-jade">{h.return_pct > 0 ? '+' : ''}{yuan(h.gain_fen)} ({h.return_pct > 0 ? '+' : ''}{h.return_pct}%)</p>
                  </div>
                  <button type="button" className="btn btn-line px-4 text-sm" disabled={!!pending} onClick={() => ask(tr(`Redeem 1000 from ${h.name}`, `赎回${h.name}1000元`))}>{tr('Redeem', '赎回')}</button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={tr('Products', '产品')} className="mt-8"
          aside={<button type="button" className="btn btn-line px-4 text-sm" disabled={!!pending || picked.length < 2}
            onClick={() => { ask(tr(`Compare ${picked.join(' and ')}`, `对比${picked.join('和')}`)); setPicked([]) }}>
            {picked.length < 2 ? tr('Tick two to compare', '勾选两个来对比') : tr(`Compare ${picked.length}`, `对比所选（${picked.length}）`)}</button>}>
          <ul className={LIST}>
            {d.products.items.map((p) => (
              <li key={p.code} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <label className="flex min-h-6 cursor-pointer items-center gap-2 font-semibold">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--action)]" checked={picked.includes(p.name)} onChange={() => pick(p.name)}
                      aria-label={tr(`Compare ${p.name}`, `对比 ${p.name}`)} />{p.name}</label>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink2">{(KIND[p.kind] ?? [p.kind, p.kind])[lang === 'zh' ? 0 : 1]}<Risk level={p.risk_level} />{tr(`redeem T+${p.redeem_days}`, `赎回 T+${p.redeem_days}`)}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="num text-lg font-semibold">{p.yield_bp ? pct(p.yield_bp) : pct(p.return_1y_bp)}</p>
                  <p className="text-xs text-ink2">{p.yield_bp ? tr('7-day annualised', '七日年化') : tr(`1 year · max drawdown ${pct(p.max_drawdown_bp)}`, `近一年 · 最大回撤 ${pct(p.max_drawdown_bp)}`)}</p>
                </div>
                {p.suitable
                  ? <button type="button" className="btn btn-ink px-4 text-sm" disabled={!!pending} onClick={() => ask(tr(`Buy 5000 of ${p.name}`, `申购${p.name}5000元`))}>{tr('Buy', '申购')}</button>
                  : <Badge tone="red">{tr('Above your level', '超出你的等级')}</Badge>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink2">{tr('Simulated products. Not investment advice.', '模拟产品，不构成投资建议。')}</p>
        </Section>
      </>}
    </main>
  )
}

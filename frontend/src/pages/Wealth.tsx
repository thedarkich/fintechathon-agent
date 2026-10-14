import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { PageHead, Section } from '../components/bits'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { EMPTY, LIST } from './Accounts'

const LEVEL: Record<number, [string, string]> = { 1: ['保守型 C1', 'Conservative C1'], 2: ['稳健型 C2', 'Cautious C2'], 3: ['平衡型 C3', 'Balanced C3'], 4: ['成长型 C4', 'Growth C4'], 5: ['进取型 C5', 'Aggressive C5'] }
const KIND: Record<string, [string, string]> = { money_market: ['货币基金', 'Money market'], bond: ['债券基金', 'Bond'], mixed: ['混合基金', 'Mixed'], equity: ['股票基金', 'Equity'], qdii: ['QDII 基金', 'QDII'] }

export default function Wealth() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const wealth = useQuery({ queryKey: ['wealth', lang], queryFn: () => api.wealth(lang) })
  const d = wealth.data
  const ask = (text: string) => void send(text)
  const pct = (bp: number) => `${(bp / 100).toFixed(2)}%`
  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Invest', '理财')}
        right={<button type="button" className="btn btn-ink px-5 py-2" disabled={!!pending} onClick={() => ask(tr('Recommend a low-risk product', '推荐一个稳健的理财'))}>{tr('Get a suggestion', '让助手推荐')}</button>} />
      {!d ? <div className="h-64 animate-pulse rounded-box bg-paper2" /> : <>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="metric-card"><dt>{tr('Market value', '持仓市值')}</dt><dd className="num">{yuan(d.holdings.value_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Total gain', '累计收益')}</dt><dd className="num text-jade">{yuan(d.holdings.gain_fen)}</dd></div>
          <div className="metric-card">
            <dt>{tr('Your risk level', '风险等级')}<button type="button" className="text-sm font-semibold text-[var(--action)]" disabled={!!pending} onClick={() => ask(tr('Redo my risk assessment', '重新做风险测评'))}>{tr('Redo', '重新测评')}</button></dt>
            <dd className="!text-[1.5rem]">{d.profile ? LEVEL[d.profile.level][lang === 'zh' ? 0 : 1] : tr('Not assessed', '未测评')}</dd>
          </div>
        </dl>

        <Section title={tr('Holdings', '持仓')} className="mt-8">
          {!d.holdings.items.length ? <p className={EMPTY}>{tr('No holdings.', '没有持仓。')}</p> : (
            <ul className={LIST}>
              {d.holdings.items.map((h) => (
                <li key={h.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{h.name} <span className="font-mono text-xs font-normal text-ink2">R{h.risk_level}</span></p>
                    <p className="text-xs text-ink2">{tr(`since ${h.since}`, `${h.since} 起`)}</p>
                  </div>
                  <div className="text-right">
                    <p className="num font-mono">{yuan(h.value_fen)}</p>
                    <p className="num font-mono text-xs text-jade">{h.return_pct > 0 ? '+' : ''}{yuan(h.gain_fen)} ({h.return_pct > 0 ? '+' : ''}{h.return_pct}%)</p>
                  </div>
                  <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Redeem 1000 from ${h.name}`, `赎回${h.name}1000元`))}>{tr('Redeem', '赎回')}</button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={tr('Products', '产品')} className="mt-8">
          <ul className={LIST}>
            {d.products.items.map((p) => (
              <li key={p.code} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-xs text-ink2">{(KIND[p.kind] ?? [p.kind, p.kind])[lang === 'zh' ? 0 : 1]} · R{p.risk_level} · {tr(`redeem T+${p.redeem_days}`, `赎回 T+${p.redeem_days}`)}</p>
                </div>
                <div className="text-right">
                  <p className="num font-mono">{p.yield_bp ? pct(p.yield_bp) : pct(p.return_1y_bp)}</p>
                  <p className="text-xs text-ink2">{p.yield_bp ? tr('7-day annualised', '七日年化') : tr(`1 year · max drawdown ${pct(p.max_drawdown_bp)}`, `近一年 · 最大回撤 ${pct(p.max_drawdown_bp)}`)}</p>
                </div>
                {p.suitable
                  ? <button type="button" className="btn btn-ink py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Buy 5000 of ${p.name}`, `申购${p.name}5000元`))}>{tr('Buy', '申购')}</button>
                  : <span className="rounded-full border border-dashed border-cinnabar px-2.5 py-0.5 text-xs font-semibold text-cinnabar">{tr('Above your level', '超出你的等级')}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink2">{tr('Simulated products. Not investment advice.', '模拟产品，不构成投资建议。')}</p>
        </Section>
      </>}
    </main>
  )
}

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Panel } from '../components/bits'
import { Icon } from '../components/Icon'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'

const LEVEL: Record<number, [string, string]> = { 1: ['保守型 C1', 'Conservative C1'], 2: ['稳健型 C2', 'Cautious C2'], 3: ['平衡型 C3', 'Balanced C3'], 4: ['成长型 C4', 'Growth C4'], 5: ['进取型 C5', 'Aggressive C5'] }
const KIND: Record<string, [string, string]> = { money_market: ['货币基金', 'Money market'], bond: ['债券基金', 'Bond'], mixed: ['混合基金', 'Mixed'], equity: ['股票基金', 'Equity'], qdii: ['QDII 基金', 'QDII'] }

export default function Wealth() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const wealth = useQuery({ queryKey: ['wealth', lang], queryFn: () => api.wealth(lang) })
  const d = wealth.data
  const ask = (text: string) => void send(text)
  return (
    <main tabIndex={-1} className="page-content ">
      <h1 className="cond text-[2.4rem] font-extrabold leading-tight">{tr('Invest', '理财')}</h1>
      <p className="max-w-[44rem] text-ink2">{tr('Your holdings and the bank’s products. You can only buy a product at or below your risk level; buying needs strong verification, redeeming needs one confirmation. All products here are simulated, and nothing here is investment advice.', '你的持仓和银行的产品。只能购买不高于你风险等级的产品；申购需要强验证，赎回只需确认。这里的产品均为模拟，不构成投资建议。')}</p>
      {!d ? <div className="mt-6 h-64 animate-pulse rounded-box bg-paper2" /> : <>
        <dl className="metric-grid mt-7">
          <div className="metric-card"><dt>{tr('Market value', '持仓市值')}<Icon name="trend" size={17} /></dt><dd className="num">{yuan(d.holdings.value_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Total gain', '累计收益')}<Icon name="chart" size={17} /></dt><dd className="num text-jade">{yuan(d.holdings.gain_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Your risk level', '风险等级')}<Icon name="shield" size={17} /></dt><dd className="!text-[1.4rem]">{d.profile ? LEVEL[d.profile.level][lang === 'zh' ? 0 : 1] : tr('Not assessed', '未测评')}</dd></div>
          <div className="metric-card"><dt>{tr('Assessed', '测评日期')}<Icon name="clock" size={17} /></dt><dd className="num !text-[1.4rem] font-mono">{d.profile ? d.profile.assessed_at.slice(0, 10) : '—'}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-box border border-rule bg-field px-5 py-4">
          <p className="flex items-center gap-2 text-sm text-ink2"><Icon name="shield" size={18} />{tr('Suitability is checked by fixed rules: a product above your level is refused, whatever the request says.', '适当性由固定规则检查：超出你风险等级的产品一律拒绝，不管请求怎么说。')}</p>
          <button type="button" className="btn btn-line whitespace-nowrap" disabled={!!pending} onClick={() => ask(tr('Redo my risk assessment', '重新做风险测评'))}>{tr('Redo the risk questionnaire', '重新做风险测评')}</button>
        </div>
        <div className="mt-6 space-y-6">
          <Panel title={tr('Holdings', '持仓')} note={tr('Redeeming returns money to your current account.', '赎回的资金会回到活期账户。')}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-left text-[0.93rem]">
                <thead><tr className="rule-b bg-paper text-[0.84rem] text-rule2"><th className="px-4 py-2 font-normal">{tr('Product', '产品')}</th><th className="px-3 py-2 font-normal">{tr('Since', '持有自')}</th><th className="px-3 py-2 text-right font-normal">{tr('Invested', '本金')}</th><th className="px-3 py-2 text-right font-normal">{tr('Gain', '收益')}</th><th className="px-3 py-2 text-right font-normal">{tr('Value', '市值')}</th><th className="px-4 py-2" /></tr></thead>
                <tbody>
                  {d.holdings.items.length === 0 && <tr><td colSpan={6} className="px-4 py-3 text-ink2">{tr('No holdings.', '没有持仓。')}</td></tr>}
                  {d.holdings.items.map((h) => (
                    <tr key={h.code} className="rule-b align-top last:border-b-0">
                      <td className="px-4 py-2.5">{h.name} <span className="ml-1 font-mono text-xs text-ink2">R{h.risk_level}</span></td>
                      <td className="num px-3 py-2.5 font-mono text-[0.85rem] text-ink2">{h.since}</td>
                      <td className="num px-3 py-2.5 text-right font-mono">{yuan(h.principal_fen)}</td>
                      <td className="num px-3 py-2.5 text-right font-mono text-jade">{yuan(h.gain_fen)} ({h.return_pct > 0 ? '+' : ''}{h.return_pct}%)</td>
                      <td className="num px-3 py-2.5 text-right font-mono">{yuan(h.value_fen)}</td>
                      <td className="px-4 py-2 text-right"><button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Redeem 1000 from ${h.name}`, `赎回${h.name}1000元`))}>{tr('Redeem', '赎回')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title={tr('Products', '产品')} note={tr('Risk R1 (lowest) to R5. Products above your level are marked and cannot be bought.', '风险等级 R1（最低）到 R5。超出你等级的产品已标出，无法购买。')}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-left text-[0.93rem]">
                <thead><tr className="rule-b bg-paper text-[0.84rem] text-rule2"><th className="px-4 py-2 font-normal">{tr('Product', '产品')}</th><th className="px-3 py-2 font-normal">{tr('Type', '类型')}</th><th className="px-3 py-2 font-normal">{tr('Risk', '风险')}</th><th className="px-3 py-2 font-normal">{tr('Return', '收益')}</th><th className="px-3 py-2 font-normal">{tr('Redemption', '赎回')}</th><th className="px-3 py-2 font-normal">{tr('For you', '是否适合')}</th><th className="px-4 py-2" /></tr></thead>
                <tbody>
                  {d.products.items.map((p) => (
                    <tr key={p.code} className="rule-b align-top last:border-b-0">
                      <td className="px-4 py-2.5"><span className="block">{p.name}</span><span className="text-[0.82rem] text-ink2">{p.description}</span></td>
                      <td className="px-3 py-2.5 text-ink2">{(KIND[p.kind] ?? [p.kind, p.kind])[lang === 'zh' ? 0 : 1]}</td>
                      <td className="px-3 py-2.5 font-mono">R{p.risk_level}</td>
                      <td className="num px-3 py-2.5 font-mono text-[0.85rem]">{p.yield_bp ? `${(p.yield_bp / 100).toFixed(2)}% ${tr('7-day', '七日年化')}` : `${(p.return_1y_bp / 100).toFixed(2)}% ${tr('1 yr', '近一年')}`}{p.max_drawdown_bp ? <span className="block text-xs text-ink2">{tr('max drawdown', '最大回撤')} {(p.max_drawdown_bp / 100).toFixed(2)}%</span> : null}</td>
                      <td className="px-3 py-2.5 font-mono text-[0.85rem]">T+{p.redeem_days}</td>
                      <td className="px-3 py-2.5">{p.suitable ? <span className="font-semibold text-jade">{tr('suitable', '适合')}</span> : <span className="inline-flex items-center rounded-[2px] border border-dashed border-cinnabar px-1.5 py-px text-[0.72rem] font-semibold leading-tight text-cinnabar">{tr('above your level', '超出等级')}</span>}</td>
                      <td className="px-4 py-2 text-right">{p.suitable && <button type="button" className="btn btn-ink py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr(`Buy 5000 of ${p.name}`, `申购${p.name}5000元`))}>{tr('Buy', '申购')}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <div className="flex flex-wrap gap-2">
            {[tr("I have 100000 I won't need for a year. What should I invest in?", '有10万一年不用，推荐个理财'), tr('Compare the money market fund and the bond fund', '对比货币基金和债券基金')].map((t) => (
              <button key={t} type="button" className="btn btn-line py-1.5" disabled={!!pending} onClick={() => ask(t)}>{t}</button>
            ))}
          </div>
        </div>
      </>}
    </main>
  )
}

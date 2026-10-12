import { useQuery } from '@tanstack/react-query'
import { CardView } from '../components/Cards'
import { Section } from '../components/Chrome'
import { useLang } from '../i18n'
import { call } from '../lib/api'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'

const LEVEL: Record<number, [string, string]> = { 1: ['保守型 C1', 'Conservative C1'], 2: ['稳健型 C2', 'Cautious C2'], 3: ['平衡型 C3', 'Balanced C3'], 4: ['成长型 C4', 'Growth C4'], 5: ['进取型 C5', 'Aggressive C5'] }

export default function Wealth() {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wealth = useQuery({ queryKey: ['wealth', lang], queryFn: () => call<any>(`/api/bank/wealth?lang=${lang}`) })
  const data = wealth.data
  if (!data) return null
  return (
    <div className="px-4 pb-8 pt-5">
      <p className="text-sm text-ink2">{tr('Investments', '理财市值')}</p>
      <p className="num text-[34px] font-extrabold leading-tight tracking-tight">{yuan(data.holdings.value_fen)}</p>
      <p className="num text-sm text-ink2">{tr('Total gain', '累计收益')} <span className="text-jade">{yuan(data.holdings.gain_fen)}</span></p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-indigo-wash px-3 py-1 font-semibold text-indigo">{data.profile ? LEVEL[data.profile.level][lang === 'zh' ? 0 : 1] : tr('No risk profile', '未测评')}</span>
        {data.profile && <span className="text-xs text-ink3">{tr('assessed', '测评于')} {data.profile.assessed_at.slice(0, 10)}</span>}
        <button className="text-xs font-semibold text-indigo" disabled={!!pending} onClick={() => void send(tr('Redo my risk assessment', '重新做风险测评'))}>{tr('Redo assessment', '重新测评')}</button>
      </div>
      <Section title={tr('Holdings', '持仓')}><CardView card={{ type: 'holdings', ...data.holdings }} /></Section>
      <Section title={tr('Products', '产品')}><CardView card={{ type: 'products', ...data.products }} /></Section>
      <p className="mt-3 text-xs text-ink3">{tr('You can only buy products at or below your risk level. Buying needs strong verification; redeeming needs a confirmation.', '只能购买不高于您风险等级的产品。申购需要强验证，赎回需要确认。')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[tr('I have 100000 I won\'t need for a year. What should I invest in?', '有10万一年不用，推荐个理财'), tr('Compare the money market fund and the bond fund', '对比货币基金和债券基金'), tr('Redeem 5000 from the money market fund', '赎回货币基金5000')].map((t) => (
          <button key={t} disabled={!!pending} onClick={() => void send(t)} className="rounded-xl border border-rule bg-sheet px-3 py-2 text-left text-sm hover:border-indigo">{t}</button>
        ))}
      </div>
    </div>
  )
}

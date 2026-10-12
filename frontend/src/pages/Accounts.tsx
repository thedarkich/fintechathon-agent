import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Empty, Section } from '../components/Chrome'
import { useLang } from '../i18n'
import { call } from '../lib/api'
import { useChat } from '../lib/chat'
import { yuan } from '../lib/format'
import { useOverview } from './Shell'

interface Note { id: string; at: string; kind: string; read: boolean; title: string; body: string; suggestion: string | null }

export default function Accounts() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const { send } = useChat()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => call<{ items: Note[] }>(`/api/notifications?lang=${lang}`) })
  useEffect(() => {
    if (location.hash === '#notifications') document.getElementById('notifications')?.scrollIntoView()
    if (overview.data?.unread) void call('/api/notifications/read', {}).then(() => qc.invalidateQueries({ queryKey: ['overview'] }))
  }, [location.hash, overview.data?.unread, qc])
  const data = overview.data
  if (!data) return null
  return (
    <div className="px-4 pb-8 pt-5">
      <p className="text-sm text-ink2">{tr('Total assets', '总资产')}</p>
      <p className="num text-[34px] font-extrabold leading-tight tracking-tight">{yuan(data.cash_fen + data.invest_fen)}</p>
      <p className="num mt-1 text-sm text-ink2">{tr('This month', '本月')} {tr('out', '支出')} {yuan(data.month_spend_fen)}, {tr('in', '收入')} {yuan(data.month_income_fen)}</p>

      <Section title={tr('Accounts', '账户')}>
        <ul className="divide-y divide-[var(--rule)] rounded-2xl border border-rule bg-sheet px-4">
          {data.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{a.name}</p>
                <p className="num text-xs text-ink3">{a.number}{a.release_on ? tr(`, returns ${a.release_on}`, `，${a.release_on} 退回`) : ''}</p>
              </div>
              <p className="num font-bold">{yuan(a.fen)}</p>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-3">
            <div><p className="font-semibold">{tr('Investments', '理财')}</p><p className="text-xs text-ink3">{tr('Market value', '持仓市值')}</p></div>
            <button className="num font-bold text-indigo" onClick={() => navigate('/wealth')}>{yuan(data.invest_fen)}</button>
          </li>
        </ul>
      </Section>

      <Section title={tr('Cards', '银行卡')} action={<button className="text-sm font-semibold text-indigo" onClick={() => navigate('/cards')}>{tr('Manage', '管理')}</button>}>
        <div className="grid grid-cols-2 gap-3">
          {data.cards.map((c) => (
            <button key={c.id} onClick={() => navigate('/cards')} className={`rounded-2xl p-3.5 text-left ${c.status === 'active' ? 'bg-indigo text-[var(--indigo-ink)]' : 'border border-rule bg-sheet text-ink2'}`}>
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="num mt-4 text-lg tracking-widest">**** {c.last4}</p>
              <p className="text-xs opacity-80">{{ active: tr('Active', '正常'), frozen: tr('Frozen', '已冻结'), lost: tr('Reported lost', '已挂失'), pending: tr('On its way', '寄送中') }[c.status]}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section title={tr('Reminders', '提醒')}>
        <div id="notifications" className="space-y-2">
          {!notes.data?.items.length && <Empty>{tr('No reminders yet. Renewals, birthdays and unusual transactions show up here.', '暂无提醒。续费、生日和异常交易会显示在这里。')}</Empty>}
          {notes.data?.items.map((n) => (
            <div key={n.id} className="rounded-2xl border border-rule bg-sheet p-3.5">
              <p className="font-semibold">{n.title}</p>
              <p className="mt-0.5 text-sm text-ink2">{n.body}</p>
              {n.suggestion && <button className="mt-2 rounded-full border border-rule px-3 py-1 text-xs font-semibold text-indigo hover:border-indigo" onClick={() => void send(n.suggestion!)}>{n.suggestion}</button>}
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}

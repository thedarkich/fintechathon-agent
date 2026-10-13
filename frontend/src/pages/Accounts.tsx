import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Card } from '../components/bits'
import { Icon } from '../components/Icon'
import { SealMark } from '../components/Seal'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { TransfersSection } from './Transfers'

export default function Accounts() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const { send, pending } = useChat()
  const location = useLocation()
  const payees = useQuery({ queryKey: ['payees'], queryFn: api.payees })
  const scheduled = useQuery({ queryKey: ['scheduled'], queryFn: api.scheduled })
  const data = overview.data
  useEffect(() => {
    if (location.hash) window.setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView(), 150)
  }, [location.hash, data])
  const ask = (text: string) => void send(text)
  const now = data ? new Date(data.now).getTime() : Date.now()

  return (
    <main tabIndex={-1} className="page-content">
      <h1 className="cond text-[2.2rem] font-extrabold leading-tight">{tr('Accounts & transfers', '账户与转账')}</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink2">{tr('Your balances, where each transfer is, and the people you pay. To send money, just tell the assistant.', '你的余额、每笔转账到哪了，以及你的收款人。要转账，直接跟助手说。')}</p>
      {!data ? <div className="mt-6 h-64 animate-pulse rounded-box bg-paper2" aria-hidden /> : <>
        <dl className="metric-grid mt-6">
          <div className="metric-card"><dt>{tr('Total', '总资产')}<Icon name="bank" size={17} /></dt><dd className="num">{yuan(data.cash_fen + data.invest_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('In your accounts', '存款')}<Icon name="wallet" size={17} /></dt><dd className="num">{yuan(data.cash_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Spent this month', '本月支出')}<Icon name="chart" size={17} /></dt><dd className="num">{yuan(data.month_spend_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Came in this month', '本月收入')}<Icon name="trend" size={17} /></dt><dd className="num text-jade">{yuan(data.month_income_fen)}</dd></div>
        </dl>

        <div className="mt-6">
          <Card title={tr('Your accounts', '你的账户')} sub={tr('Money set aside for a plan goes back to your current account after its date.', '为计划预留的钱，到期后会自动回到活期账户。')}>
            <ul className="divide-y divide-[var(--rule)] ruled">
              {data.accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                  <span className="font-semibold">{a.name}</span>
                  <span className="font-mono text-[0.82rem] text-ink2">{a.number}</span>
                  {a.release_on && <span className="text-xs text-ink2">{tr(`returns ${a.release_on}`, `${a.release_on} 退回`)}</span>}
                  <strong className="num ml-auto font-mono">{yuan(a.fen)}</strong>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="mt-8"><TransfersSection /></div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <Card title={tr('People you pay', '收款人')} sub={tr('You can only pay people on this list. For someone added in the last 24 hours, anything over ¥500 needs your PIN and a code, and arrives 2 hours later.', '只能向名单里的人付款。24 小时内新加的收款人，超过 ¥500 要交易密码和验证码，并且 2 小时后才到账。')}>
            {!payees.data ? <div className="h-32 animate-pulse rounded-box bg-paper2" /> : (
              <ul className="divide-y divide-[var(--rule)] ruled">
                {payees.data.items.map((p) => {
                  const fresh = now - new Date(p.created_at).getTime() < 86_400_000
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-semibold">{lang === 'zh' ? p.name : `${p.name_en} ${p.name}`}</span>
                      {(lang === 'zh' ? p.note : p.note_en) && <span className="text-ink2">{lang === 'zh' ? p.note : p.note_en}</span>}
                      <span className="font-mono text-[0.8rem] text-ink2">{lang === 'zh' ? p.bank : p.bank_en} ****{p.account_tail}</span>
                      {fresh && <span className="ml-auto text-xs font-semibold text-cinnabar">{tr('added today', '今天新加')}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink2">{tr('To add someone, tell the assistant their name and phone or account number.', '要添加收款人，告诉助手对方的姓名和手机号或卡号。')}</p>
          </Card>

          <div className="space-y-5">
            <Card title={tr('Scheduled transfers', '预约转账')} sub={tr('Each one is checked again on the day it runs.', '每一笔在执行当天都会再检查一次。')}>
              {!scheduled.data?.transfers.length ? (
                <div className="text-sm text-ink2">
                  <p>{tr('Nothing scheduled.', '暂无预约。')}</p>
                  <button type="button" className="btn btn-line mt-2 py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr('Every month on the 15th send Mom 500', '每月15号给妈妈转500'))}>{tr('Every month on the 15th send Mom 500', '每月15号给妈妈转500')}</button>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--rule)] ruled">
                  {scheduled.data.transfers.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <SealMark kind={s.status === 'done' ? 'done' : s.status === 'cancelled' ? 'cancelled' : s.status === 'waiting_approval' ? 'pending' : 'scheduled'} size={24} />
                      <span className="font-semibold">{s.payee}</span>
                      <span className="font-mono text-[0.8rem] text-ink2">{stamp(s.run_at)}{s.repeat === 'monthly' ? tr(', monthly', '，每月') : ''}</span>
                      <strong className="num ml-auto font-mono">{yuan(s.fen)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={tr('Split bills', 'AA 收款')} sub={tr('Requests you sent. Friends’ shares come back to your current account.', '你发出的收款请求，朋友付款后回到活期账户。')}>
              {!scheduled.data?.collections.length ? (
                <div className="text-sm text-ink2">
                  <p>{tr('No split bills yet.', '还没有 AA 收款。')}</p>
                  <button type="button" className="btn btn-line mt-2 py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(tr("Split last night's hotpot with Liu Yang and Wang Fang", '昨晚海底捞和刘洋、王芳AA'))}>{tr("Split last night's hotpot with Liu Yang and Wang Fang", '昨晚海底捞和刘洋、王芳AA')}</button>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--rule)] ruled">
                  {scheduled.data.collections.map((c) => (
                    <li key={c.id} className="px-3 py-2 text-sm">
                      <p className="flex justify-between gap-3"><span className="font-semibold">{c.title}</span><span className="num font-mono">{yuan(c.total_fen)}</span></p>
                      <p className="text-xs text-ink2">{c.participants.map((p) => `${lang === 'zh' ? p.name : p.name_en} ${p.status === 'paid' ? tr('paid', '已付') : tr('not yet', '未付')}`).join(lang === 'zh' ? '，' : ', ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </>}
    </main>
  )
}

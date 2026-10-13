import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { Card } from '../components/bits'
import { Icon } from '../components/Icon'
import { SealMark } from '../components/Seal'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { category, stamp, yuan } from '../lib/format'

export default function Accounts() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const { send, pending } = useChat()
  const qc = useQueryClient()
  const location = useLocation()
  const payees = useQuery({ queryKey: ['payees'], queryFn: api.payees })
  const scheduled = useQuery({ queryKey: ['scheduled'], queryFn: api.scheduled })
  const notes = useQuery({ queryKey: ['notifications', lang], queryFn: () => api.notifications(lang) })
  const [q, setQ] = useState('')
  const txns = useQuery({ queryKey: ['transactions', 'accounts', q], queryFn: () => api.transactions(60, q, 80) })
  const data = overview.data
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
    if (data?.unread) void api.readNotifications().then(() => qc.invalidateQueries({ queryKey: ['overview'] }))
  }, [location.hash, data?.unread, qc])
  const ask = (text: string) => void send(text)
  const now = data ? new Date(data.now).getTime() : Date.now()

  return (
    <main tabIndex={-1} className="page-content">
      <h1 className="cond text-[2.4rem] font-extrabold leading-tight">{tr('Accounts', '账户')}</h1>
      <p className="mt-2 max-w-3xl text-sm text-ink2">{tr('Your simulated bank: balances, the people you pay, and what is scheduled. Changes go through the assistant, so every one is checked by the same rules and written to your ledger.', '你的模拟银行：余额、收款人和预约事项。所有变更都通过助手办理，每一项都经过同样的规则检查并写入账本。')}</p>
      {data && (
        <p className="mt-3 inline-block rounded-box border border-rule2 px-3 py-1.5 text-sm text-ink2">
          {tr('Simulated bank · no real money', '模拟银行 · 不涉及真实资金')} · {tr('bank time', '银行时间')} {stamp(data.now)}
        </p>
      )}
      {!data ? <div className="mt-6 h-64 animate-pulse rounded-box bg-paper2" aria-hidden /> : <>
        <dl className="metric-grid mt-6">
          <div className="metric-card"><dt>{tr('Total assets', '总资产')}<Icon name="bank" size={17} /></dt><dd className="num">{yuan(data.cash_fen + data.invest_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Cash', '存款')}<Icon name="wallet" size={17} /></dt><dd className="num">{yuan(data.cash_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Spent this month', '本月支出')}<Icon name="chart" size={17} /></dt><dd className="num">{yuan(data.month_spend_fen)}</dd></div>
          <div className="metric-card"><dt>{tr('Income this month', '本月收入')}<Icon name="trend" size={17} /></dt><dd className="num text-jade">{yuan(data.month_income_fen)}</dd></div>
        </dl>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Card title={tr('1 · Your accounts', '1 · 你的账户')} sub={tr('Current, savings and any money set aside for a plan. A reserve returns to the current account after its date.', '活期、储蓄，以及为计划预留的资金。预留资金到期后自动退回活期。')}>
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
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-line py-1.5" disabled={!!pending} onClick={() => ask(tr("What's my balance?", '我卡里还有多少钱'))}>{tr('Ask for balances', '问助手余额')}</button>
              <button type="button" className="btn btn-line py-1.5" disabled={!!pending} onClick={() => ask(tr('Set aside 500 for a trip', '预留500元旅游基金'))}>{tr('Set money aside', '预留资金')}</button>
            </div>
          </Card>

          <Card title={tr('2 · Payees', '2 · 收款人')} sub={tr('Only people on this list can be paid. A payee added in the last 24 hours needs strong verification for anything over ¥500.', '只能向名单里的人付款。24 小时内新加的收款人，超过 ¥500 的付款需要强验证。')}>
            {!payees.data ? <div className="h-32 animate-pulse rounded-box bg-paper2" /> : (
              <ul className="divide-y divide-[var(--rule)] ruled">
                {payees.data.items.map((p) => {
                  const fresh = now - new Date(p.created_at).getTime() < 86_400_000
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-semibold">{lang === 'zh' ? p.name : `${p.name_en} ${p.name}`}</span>
                      {p.note && <span className="text-ink2">{p.note}</span>}
                      <span className="font-mono text-[0.8rem] text-ink2">{p.bank} ****{p.account_tail}</span>
                      <span className={`ml-auto text-xs font-semibold ${fresh ? 'text-cinnabar' : 'text-jade'}`}>{fresh ? tr('added today: large payments need a strong check', '今天新加：大额需强验证') : tr('active', '可收款')}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-2 text-xs text-ink2">{tr('To add someone, tell the assistant their name and phone or account number.', '要添加收款人，告诉助手对方的姓名和手机号或卡号。')}</p>
          </Card>

          <Card title={tr('3 · Scheduled transfers', '3 · 预约转账')} sub={tr('Each one is checked against that day’s ¥1,000 total again when it runs. If the total has grown, it waits for a strong check.', '每一笔执行时都会按当天的 ¥1,000 累计额度重新检查；如果当天累计已超额，会等待强验证。')}>
            {!scheduled.data?.transfers.length ? <p className="text-sm text-ink2">{tr('Nothing scheduled. Try “send Mom 500 on the 15th of every month”.', '暂无预约。试试“每月15号给妈妈转500”。')}</p> : (
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

          <Card title={tr('4 · Split bills', '4 · AA 收款')} sub={tr('Requests you sent. Friends pay their share back into your current account.', '你发出的收款请求，朋友付款后会回到你的活期账户。')}>
            {!scheduled.data?.collections.length ? <p className="text-sm text-ink2">{tr('No split bills yet. Try attaching a receipt and asking to split it.', '还没有 AA 收款。试试附上小票，让助手帮你平摊。')}</p> : (
              <ul className="divide-y divide-[var(--rule)] ruled">
                {scheduled.data.collections.map((c) => (
                  <li key={c.id} className="px-3 py-2 text-sm">
                    <p className="flex justify-between gap-3"><span className="font-semibold">{c.title}</span><span className="num font-mono">{yuan(c.total_fen)}</span></p>
                    <p className="text-xs text-ink2">{c.participants.map((p) => `${lang === 'zh' ? p.name : p.name_en} ${p.status === 'paid' ? tr('paid', '已付') : tr('pending', '未付')}`).join(lang === 'zh' ? '，' : ', ')}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="min-w-0 lg:col-span-2" id="notifications">
            <Card title={tr('Reminders', '提醒')} sub={tr('Renewals, birthdays and transactions worth a look. Each suggestion asks the assistant, and still goes through the rules.', '续费、生日和值得留意的交易。每条建议都会交给助手，同样经过规则检查。')}>
              {!notes.data?.items.length ? <p className="text-sm text-ink2">{tr('No reminders yet.', '暂无提醒。')}</p> : (
                <ul className="divide-y divide-[var(--rule)] ruled">
                  {notes.data.items.map((n) => (
                    <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-sm">
                      <SealMark kind={n.kind === 'anomaly' ? 'flag' : n.kind === 'birthday' ? 'scheduled' : 'pending'} size={26} />
                      <div className="min-w-0 flex-1"><p className="font-semibold">{n.title}</p><p className="text-ink2">{n.body}</p></div>
                      {n.suggestion && <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => ask(n.suggestion!)}>{n.suggestion}</button>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="min-w-0 lg:col-span-2">
            <Card title={tr('Payments, last 60 days', '近 60 天收支')} sub={tr('Read straight from the bank. Declined attempts stay visible.', '直接读取银行记录，被拒绝的尝试也会保留。')}
              right={<label className="flex w-48 items-center gap-2 rounded-box border border-rule bg-field px-3 py-1.5"><Icon name="search" size={15} className="text-ink2" /><input className="min-w-0 w-full bg-transparent text-sm" aria-label={tr('Search', '搜索')} placeholder={tr('Search…', '搜索…')} value={q} onChange={(e) => setQ(e.target.value)} /></label>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                  <thead><tr className="rule-b text-[0.84rem] text-rule2"><th className="py-1.5 pr-3 font-normal">{tr('Time', '时间')}</th><th className="py-1.5 pr-3 font-normal">{tr('Counterparty', '对方')}</th><th className="py-1.5 pr-3 font-normal">{tr('Category', '类别')}</th><th className="py-1.5 text-right font-normal">{tr('Amount', '金额')}</th></tr></thead>
                  <tbody>
                    {txns.data?.items.map((x) => (
                      <tr key={x.id} className={`rule-b last:border-b-0 ${x.status === 'declined' ? 'text-ink2' : ''}`}>
                        <td className="num py-1.5 pr-3 font-mono text-[0.8rem] text-ink2">{stamp(x.at)}</td>
                        <td className="py-1.5 pr-3">{x.merchant}{x.status === 'declined' && <span className="ml-1.5 text-xs font-semibold text-cinnabar">{tr('declined', '已拒绝')}</span>}</td>
                        <td className="py-1.5 pr-3 text-ink2">{category(x.category, lang)}</td>
                        <td className={`num py-1.5 text-right font-mono ${x.fen > 0 ? 'text-jade' : ''}`}>{x.fen > 0 ? '+' : ''}{yuan(x.fen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </>}
    </main>
  )
}

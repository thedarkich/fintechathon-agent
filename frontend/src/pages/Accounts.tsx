import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLang } from '../i18n'
import { AskButton, PageHead, Section } from '../components/bits'
import { SealMark } from '../components/Seal'
import { useOverview } from '../lib/bank'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'
import { TransfersSection } from './Transfers'

export const LIST = 'divide-y divide-[var(--rule)] ruled bg-field'
export const ROW = 'flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-3 text-[0.95rem]'
export const EMPTY = 'ruled bg-field px-4 py-4 text-sm text-ink2'

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
  const now = data ? new Date(data.now).getTime() : Date.now()

  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Accounts & transfers', '账户与转账')}
        right={<Link to="/send" className="btn btn-ink px-5 py-2">{tr('Send money', '转账')}</Link>} />
      {!data ? <div className="h-64 animate-pulse rounded-box bg-paper2" aria-hidden /> : <>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]" aria-label={tr('Balances', '余额')}>
          <div className="rounded-panel px-6 py-6 text-white shadow-[0_14px_34px_var(--shadow)]" style={{ background: 'var(--hero)' }}>
            <p className="text-sm">{tr('Total', '总资产')}</p>
            <p className="num mt-1 font-mono text-[2.1rem] font-bold leading-tight">{yuan(data.cash_fen + data.invest_fen)}</p>
            <p className="mt-2 text-sm">{tr(`Cash ${yuan(data.cash_fen)} · invested ${yuan(data.invest_fen)}`, `存款 ${yuan(data.cash_fen)} · 理财 ${yuan(data.invest_fen)}`)}</p>
          </div>
          <ul className={LIST}>
            {data.accounts.map((a) => (
              <li key={a.id} className={ROW}>
                <span className="font-semibold">{a.name}</span>
                <span className="font-mono text-[0.82rem] text-ink2">{a.number.slice(-4)}</span>
                {a.release_on && <span className="text-xs text-ink2">{tr(`back on ${a.release_on}`, `${a.release_on} 退回活期`)}</span>}
                <strong className="num ml-auto font-mono">{yuan(a.fen)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <TransfersSection className="mt-10" />

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2">
          <Section title={tr('Payees', '收款人')} aside={<AskButton label={tr('Add', '添加')} hint={tr('Add payee Wang Xiaoming 13800001111', '添加收款人 王小明 13800001111')} />}>
            {!payees.data ? <div className="h-32 animate-pulse rounded-box bg-paper2" /> : (
              <ul className={LIST}>
                {payees.data.items.map((p) => (
                  <li key={p.id} className={ROW}>
                    <span className="font-semibold">{lang === 'zh' ? p.name : p.name_en}</span>
                    {(lang === 'zh' ? p.note : p.note_en) && <span className="text-sm text-ink2">{lang === 'zh' ? p.note : p.note_en}</span>}
                    <span className="ml-auto font-mono text-[0.8rem] text-ink2">{lang === 'zh' ? p.bank : p.bank_en} {p.account_tail}</span>
                    {now - new Date(p.created_at).getTime() < 86_400_000 && <span className="w-full text-xs font-semibold text-cinnabar">{tr('Added today', '今天新加')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="space-y-8">
            <Section title={tr('Scheduled', '预约转账')} aside={<AskButton label={tr('Schedule', '预约')} hint={tr('Send Mom 500 on the 15th of every month', '每月15号给妈妈转500')} />}>
              {!scheduled.data?.transfers.length ? <p className={EMPTY}>{tr('Nothing scheduled.', '暂无预约。')}</p> : (
                <ul className={LIST}>
                  {scheduled.data.transfers.map((s) => (
                    <li key={s.id} className={ROW}>
                      <SealMark kind={s.status === 'done' ? 'done' : s.status === 'cancelled' ? 'cancelled' : s.status === 'waiting_approval' ? 'pending' : 'scheduled'} size={24} />
                      <span className="font-semibold">{lang === 'zh' ? s.payee : s.payee_en}</span>
                      <span className="font-mono text-[0.8rem] text-ink2">{stamp(s.run_at)}{s.repeat === 'monthly' ? tr(', monthly', '，每月') : ''}</span>
                      <strong className="num ml-auto font-mono">{yuan(s.fen)}</strong>
                      {(s.status === 'scheduled' || s.status === 'waiting_approval') && (
                        <button type="button" className="text-sm font-semibold text-[var(--action)]" disabled={!!pending}
                          onClick={() => void send(tr(`Stop the scheduled transfer to ${s.payee_en}`, `取消给${s.payee}的预约转账`))}>{tr('Stop', '停止')}</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={tr('Split bills', 'AA 收款')} aside={<AskButton label={tr('Split', '发起')} hint={tr('Split a 300 electricity bill with my roommate', '和室友AA 300元电费')} />}>
              {!scheduled.data?.collections.length ? <p className={EMPTY}>{tr('No split bills.', '暂无 AA 收款。')}</p> : (
                <ul className={LIST}>
                  {scheduled.data.collections.map((c) => (
                    <li key={c.id} className="px-4 py-3 text-[0.95rem]">
                      <p className="flex justify-between gap-3"><span className="font-semibold">{c.title}</span><span className="num font-mono">{yuan(c.total_fen)}</span></p>
                      <p className="text-sm text-ink2">{c.participants.map((p) => `${lang === 'zh' ? p.name : p.name_en} ${p.status === 'paid' ? tr('paid', '已付') : tr('not yet', '未付')}`).join(lang === 'zh' ? '，' : ', ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </>}
    </main>
  )
}

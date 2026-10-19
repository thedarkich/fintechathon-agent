import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Undo2 } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { Transfer, TransferStatus } from '../api/types'
import { useLang } from '../i18n'
import { Section, Segmented } from '../components/bits'
import { SealMark, type MarkKind } from '../components/Seal'
import { usePhone } from '../components/Verify'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'

const MARK: Record<TransferStatus, MarkKind> = {
  accepted: 'pending', clearing: 'pending', arrived: 'done', returned: 'undone', cancelled: 'cancelled',
}

/** The stages a transfer passes through; the last box reads Returned or Cancelled when it didn't arrive. */
function Stages({ t }: { t: Transfer }) {
  const { tr } = useLang()
  const reached = (status: TransferStatus) => t.events.find((e) => e.status === status)
  const end: TransferStatus = t.status === 'returned' || t.status === 'cancelled' ? t.status : 'arrived'
  const boxes: { status: TransferStatus; zh: string; en: string }[] = [
    { status: 'accepted', zh: '已受理', en: 'Accepted' },
    { status: 'clearing', zh: '清算中', en: 'Clearing' },
    { status: end, zh: end === 'returned' ? '已退回' : end === 'cancelled' ? '已撤销' : '已到账', en: end === 'returned' ? 'Returned' : end === 'cancelled' ? 'Cancelled' : 'Arrived' },
  ]
  const waiting = t.status === 'accepted' ? 1 : -1 // the next stage pulses while the transfer waits
  return (
    <ol className="grid grid-cols-3 overflow-hidden rounded-box bg-[var(--field)]" aria-label={tr('Stages', '进度')}>
      {boxes.map((b, i) => {
        const event = reached(b.status)
        const bad = event && (b.status === 'returned' || b.status === 'cancelled')
        return (
          <li key={b.status} className={`flex min-h-[4.4rem] flex-col items-center justify-center gap-1 px-1 py-2 text-center ${i < 2 ? 'border-r border-rule' : ''}`}>
            <span className={`text-[0.8rem] ${event ? 'font-semibold' : 'text-ink2'}`}>{tr(b.en, b.zh)}</span>
            {event ? (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full" aria-hidden
                style={{ color: bad ? 'var(--ink-2)' : 'var(--jade)', background: `color-mix(in srgb, ${bad ? 'var(--ink-2)' : 'var(--jade)'} 14%, transparent)` }}>
                {bad ? <Undo2 size={15} strokeWidth={2.4} /> : <Check size={15} strokeWidth={2.6} />}
              </span>
            ) : (
              <span className={`h-7 w-7 rounded-full border-2 border-dashed border-rule ${i === waiting ? 'step-live' : ''}`} aria-hidden />
            )}
            <span className="num font-mono text-[0.7rem] text-ink2">{event ? stamp(event.at).slice(6) : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** One transfer on one line: who, how much, and what happened to it. The stages and route fold underneath. */
function TransferRow({ t, demo, open, onDone }: { t: Transfer; demo: boolean; open: boolean; onDone: (text: string, ok: boolean) => void }) {
  const { tr, lang } = useLang()
  const { send, pending } = useChat()
  const [busy, setBusy] = useState(false)
  async function step(outcome: 'next' | 'return') {
    setBusy(true)
    try {
      const moved = await api.demoTransfer(t.id, outcome, lang)
      onDone(tr(`Transfer ${moved.status_label.toLowerCase()}.`, `转账${moved.status_label}。`), true)
    } catch (err) {
      onDone(errorText(err, lang), false)
    } finally {
      setBusy(false)
    }
  }
  const arrived = t.events.find((e) => e.status === 'arrived')
  const status = t.status === 'arrived' ? tr(`Arrived ${arrived ? stamp(arrived.at) : ''}`, `已到账 ${arrived ? stamp(arrived.at) : ''}`)
    : t.status === 'returned' ? tr(`Returned: ${t.reason}. The money is back.`, `已退回：${t.reason}，钱已退回`)
      : t.status === 'cancelled' ? tr('Cancelled before it arrived. The money is back.', '到账前已撤销，钱已退回')
        : tr(`On its way, due ${stamp(t.arrive_at)}`, `等待到账，预计 ${stamp(t.arrive_at)}`) + (t.arrival_reason ? tr(' (delayed: new payee)', '（新收款人，规则延时）') : '')
  const waiting = t.status === 'accepted'
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <SealMark kind={MARK[t.status]} size={26} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{t.payee} <span className="font-mono text-[0.8rem] font-normal text-ink2">{t.bank} {t.account_tail}</span></p>
          <p className={`text-[0.85rem] ${t.status === 'returned' ? 'font-semibold text-cinnabar' : waiting ? 'text-ink' : 'text-ink2'}`}>{status}</p>
        </div>
        <strong className="num shrink-0 font-mono">{yuan(t.fen)}</strong>
      </div>
      {(t.cancellable || (demo && waiting)) && (
        <div className="mt-2 flex flex-wrap gap-2 pl-[38px]">
          {t.cancellable && <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => void send(tr(`Cancel transfer #${t.id.slice(0, 8)}`, `撤销转账 #${t.id.slice(0, 8)}`))}>{tr('Cancel', '撤销')}</button>}
          {demo && waiting && <>
            <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => void step('next')}>{tr('Demo: clear it now', '演示：立即清算')}</button>
            <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => void step('return')}>{tr('Demo: payee bank returns it', '演示：对方银行退回')}</button>
          </>}
        </div>
      )}
      <details className="mt-2 pl-[38px]" open={open}>
        <summary className="cursor-pointer text-[0.82rem] text-ink2">{tr('Stages', '进度')}</summary>
        <div className="mt-2"><Stages t={t} /></div>
        <p className="mt-2 text-[0.8rem] text-ink2">{t.route_label} · {t.arrival_label}{t.memo ? ` · ${tr('note', '备注')} ${t.memo}` : ''}</p>
      </details>
    </li>
  )
}

/** Both simulated phones in one panel: yours (codes, returns) and the payee's (what their bank sends). */
function SmsPanel() {
  const { tr, lang } = useLang()
  const [tab, setTab] = useState<'mine' | 'theirs'>('mine')
  const mine = usePhone(true)
  const theirs = useQuery({ queryKey: ['payee-phone'], queryFn: api.payeePhone, refetchInterval: 2500 })
  const items = tab === 'mine'
    ? (mine.data?.items ?? []).map((m) => ({ id: m.id, who: null as string | null, text: lang === 'zh' ? m.text : m.text_en, at: m.at }))
    : (theirs.data?.items ?? []).map((m) => ({ id: m.id, who: lang === 'zh' ? m.payee : m.payee_en, text: lang === 'zh' ? m.text : m.text_en, at: m.at }))
  return (
    <div className="card">
      <div className="p-3 pb-0">
        <p className="mb-2 px-1 text-sm font-semibold">{tr('Text messages', '短信')} <span className="font-normal text-ink2">{tr('(simulated phones)', '（模拟手机）')}</span></p>
        <Segmented stretch className="flex w-full" label={tr('Text messages', '短信')} value={tab} onChange={setTab}
          options={[['mine', tr('Your phone', '我的手机')], ['theirs', tr('Payee’s phone', '收款方手机')]] as const} />
      </div>
      {!items.length ? <p className="px-4 py-4 text-sm text-ink2">{tr('No messages.', '暂无短信。')}</p> : (
        <ol className="max-h-80 space-y-2 overflow-y-auto p-3">
          {items.map((m) => (
            <li key={m.id} className="rounded-box bg-[var(--field)] px-3 py-2 text-[0.85rem] leading-relaxed">
              {m.who && <span className="mb-0.5 block text-xs font-semibold text-ink2">{m.who}</span>}
              {m.text}
              <span className="mt-1 block font-mono text-[0.72rem] text-ink2">{stamp(m.at)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Transfers as the bank processes them, next to both phones: a tab of the Transfers page. */
export function TransfersSection({ className = '' }: { className?: string }) {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: 60_000 })
  const list = useQuery({
    queryKey: ['transfers', lang], queryFn: () => api.transfers(lang),
    refetchInterval: (query) => (query.state.data?.items.some((t) => t.status === 'accepted') ? 4000 : false),
  })
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null)
  const items = list.data?.items ?? []
  const done = (text: string, ok: boolean) => {
    setStatus({ text, ok })
    void qc.invalidateQueries()
  }
  return (
    <Section id="transfers" title={tr('Where my money is', '到账进度')} className={className}
      aside={status && <p role="status" className={`text-sm font-semibold ${status.ok ? 'text-jade' : 'text-cinnabar'}`}>{status.text}</p>}>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {!list.data ? <div className="h-40 animate-pulse rounded-box bg-paper2" /> : !items.length
          ? <p className="card px-4 py-4 text-sm text-ink2">{tr('No transfers yet.', '还没有转账。')}</p>
          : <ul className="min-w-0 divide-y divide-[var(--rule)] card">{items.map((t, i) => <TransferRow key={t.id} t={t} demo={!!health.data?.demo_tools} open={i === 0} onDone={done} />)}</ul>}
        <SmsPanel />
      </div>
    </Section>
  )
}

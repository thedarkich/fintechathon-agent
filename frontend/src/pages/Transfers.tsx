import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api/client'
import type { Transfer, TransferStatus } from '../api/types'
import { useLang } from '../i18n'
import { Panel } from '../components/bits'
import { Icon } from '../components/Icon'
import { SealMark, type MarkKind } from '../components/Seal'
import { usePhone } from '../components/Verify'
import { useChat } from '../lib/chat'
import { stamp, yuan } from '../lib/format'

const MARK: Record<TransferStatus, MarkKind> = {
  accepted: 'pending', clearing: 'pending', arrived: 'done', returned: 'undone', cancelled: 'cancelled',
}

/** The stages a transfer passes through; the last box reads 已退回 or 已撤销 when it didn't arrive. */
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
    <ol className="ruled mt-3 grid grid-cols-3 overflow-hidden bg-field" aria-label={tr('Stages', '进度')}>
      {boxes.map((b, i) => {
        const event = reached(b.status)
        const bad = event && (b.status === 'returned' || b.status === 'cancelled')
        return (
          <li key={b.status} className={`flex min-h-[4.6rem] flex-col items-center justify-center gap-1 px-1 py-2 text-center ${i < 2 ? 'border-r border-rule' : ''}`}>
            <span className={`text-[0.8rem] ${event ? 'font-semibold' : 'text-ink2'}`}>{tr(b.en, b.zh)}</span>
            {event ? (
              <span className="seal-stamp inline-flex h-7 min-w-7 items-center justify-center rounded-[2px] px-1 text-[0.78rem] font-bold"
                style={{ border: `2px solid ${bad ? 'var(--ink-2)' : 'var(--cinnabar)'}`, color: bad ? 'var(--ink-2)' : 'var(--cinnabar)', ['--seal-rot' as string]: `${i % 2 ? 5 : -6}deg` }}>
                {b.status === 'accepted' ? '受' : b.status === 'clearing' ? '清' : b.status === 'arrived' ? '到' : b.status === 'returned' ? '退' : '撤'}
              </span>
            ) : (
              <span className={`h-7 w-7 rounded-[2px] border-2 border-dashed border-rule ${i === waiting ? 'step-live' : ''}`} aria-hidden />
            )}
            <span className="num font-mono text-[0.7rem] text-ink2">{event ? stamp(event.at).slice(6) : i === 2 && t.status === 'accepted' ? tr(`due ${stamp(t.arrive_at)}`, `预计 ${stamp(t.arrive_at)}`) : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}

function TransferRow({ t, demo, onDone }: { t: Transfer; demo: boolean; onDone: (text: string, ok: boolean) => void }) {
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
  return (
    <li className="px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <SealMark kind={MARK[t.status]} size={26} />
        <span className="font-semibold">{t.payee}</span>
        <span className="font-mono text-[0.8rem] text-ink2">{t.bank} ****{t.account_tail}</span>
        <strong className="num ml-auto font-mono text-base">{yuan(t.fen)}</strong>
      </div>
      <p className="mt-1 text-[0.82rem] text-ink2">
        {t.route_label} · {t.arrival_label}
        {t.arrival_reason && <span className="text-cinnabar"> · {tr('delayed by the rules: payee added today', '规则延时：今天新加的收款人')}</span>}
        {t.memo && <> · {tr('note', '备注')} “{t.memo}”</>}
      </p>
      <Stages t={t} />
      {t.reason && <p className="mt-2 text-sm font-semibold text-cinnabar">{tr(`Returned by the payee's bank: ${t.reason}. The money is back in your account.`, `对方银行退回：${t.reason}。钱已回到您的账户。`)}</p>}
      {(t.cancellable || (demo && t.status === 'accepted')) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {t.cancellable && <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => void send(tr(`Cancel transfer #${t.id.slice(0, 8)}`, `撤销转账 #${t.id.slice(0, 8)}`))}>{tr('Cancel before it arrives', '到账前撤销')}</button>}
          {demo && t.status === 'accepted' && <>
            <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => void step('next')}>{tr('Demo: clear it now', '演示：立即清算')}</button>
            <button type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={busy} onClick={() => void step('return')}>{tr('Demo: payee bank returns it', '演示：对方银行退回')}</button>
          </>}
        </div>
      )}
    </li>
  )
}

function Phones() {
  const { tr, lang } = useLang()
  const mine = usePhone(true)
  const theirs = useQuery({ queryKey: ['payee-phone'], queryFn: api.payeePhone, refetchInterval: 2500 })
  const box = 'max-h-80 space-y-2 overflow-y-auto'
  const item = 'rounded-box border border-rule bg-sheet px-3 py-2 text-[0.85rem] leading-relaxed'
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
      <Panel title={tr('Your phone', '您的手机')} note={tr('Codes, returns and cancellations from your bank.', '本行发来的验证码、退回和撤销通知。')}>
        <div className="p-4">
          <p className="mb-2 flex items-center gap-1.5 font-mono text-xs text-ink2"><Icon name="phone" size={14} />{mine.data?.number}</p>
          {!mine.data?.items.length ? <p className="text-sm text-ink2">{tr('No messages yet.', '暂无短信。')}</p> : (
            <ol className={box}>{mine.data.items.map((m) => <li key={m.id} className={item}>{lang === 'zh' ? m.text : m.text_en}<span className="mt-1 block font-mono text-[0.72rem] text-ink2">{stamp(m.at)}</span></li>)}</ol>
          )}
        </div>
      </Panel>
      <Panel title={tr('Payee’s phone', '收款方手机')} note={tr('What the people you pay receive from their own bank when the money lands.', '钱到账时，收款方从自己银行收到的短信。')}>
        <div className="p-4">
          {!theirs.data?.items.length ? <p className="text-sm text-ink2">{tr('Nothing has arrived yet.', '还没有到账短信。')}</p> : (
            <ol className={box}>{theirs.data.items.map((m) => <li key={m.id} className={item}><span className="mb-0.5 block text-xs font-semibold text-ink2">{lang === 'zh' ? m.payee : m.payee_en}</span>{lang === 'zh' ? m.text : m.text_en}</li>)}</ol>
          )}
        </div>
      </Panel>
    </div>
  )
}

/** Transfers as the bank processes them, next to your phone and the payee's: a section of the Accounts page. */
export function TransfersSection() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const { send, pending } = useChat()
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
    <section id="transfers" className="scroll-mt-6">
      <h2 className="cond text-xl font-bold">{tr('Where your money is', '转账到哪了')}</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink2">{tr('Each transfer from the moment the bank takes it to the moment it lands. A transfer that is still waiting can be cancelled.', '每笔转账从银行受理到到账的全过程。还没到账的转账可以撤销。')}</p>
      {status && <p role="status" className={`mt-3 text-sm font-semibold ${status.ok ? 'text-jade' : 'text-cinnabar'}`}>{status.text}</p>}
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 ruled bg-field">
          {!list.data ? <div className="m-4 h-40 animate-pulse rounded-box bg-paper2" /> : !items.length ? (
            <div className="space-y-3 p-4 text-sm text-ink2">
              <p>{tr('No transfers yet. Try one:', '还没有转账，试试：')}</p>
              <div className="flex flex-wrap gap-2">
                {[tr('Send my wife 200', '给老婆转200'), tr('Send mom 200', '给妈妈转200'), tr('Send Zhou Kai 800', '给周凯转800'), tr('Send dad 300, arriving in 2 hours', '给爸爸转300，2小时后到账')].map((text) => (
                  <button key={text} type="button" className="btn btn-line py-1 text-[0.85rem]" disabled={!!pending} onClick={() => void send(text)}>{text}</button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--rule)]">
              {items.map((t) => <TransferRow key={t.id} t={t} demo={!!health.data?.demo_tools} onDone={done} />)}
            </ul>
          )}
        </div>
        <Phones />
      </div>
    </section>
  )
}

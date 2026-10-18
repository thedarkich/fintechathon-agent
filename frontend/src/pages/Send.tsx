import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Directory } from '../api/types'
import { useLang } from '../i18n'
import { PageHead, Segmented } from '../components/bits'
import { ScreenConfirm, useScreenPlan } from '../components/ScreenPlan'
import { useOverview } from '../lib/bank'
import { stamp, yuan } from '../lib/format'

const PHONE = /^1[3-9]\d{9}$/
const AMOUNT = /^\d{1,6}(\.\d{1,2})?$/

/** 13971230418 → 139 7123 0418, as people read phone numbers. */
const spaced = (digits: string) => [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)].filter(Boolean).join(' ')

function digitsOf(text: string) {
  let digits = text.replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('86')) digits = digits.slice(2)  // pasted as +86 …
  return digits.slice(0, 11)
}

function Avatar({ name, masked = false }: { name: string; masked?: boolean }) {
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[1.05rem] font-bold ${masked ? 'bg-paper2 text-ink2' : 'bg-[var(--accent-wash)] text-[var(--action)]'}`} aria-hidden>
      {masked ? '*' : name.replace(/^\*/, '').slice(0, 1)}
    </span>
  )
}

type Picked = { id: string; name: string; detail: string }

/** Transfers the way people send money from their phone: type a number, see who it is, send. */
export default function Send() {
  const { tr, lang } = useLang()
  const overview = useOverview()
  const payees = useQuery({ queryKey: ['payees'], queryFn: api.payees })
  const transfers = useQuery({ queryKey: ['transfers', lang], queryFn: () => api.transfers(lang) })
  const [tab, setTab] = useState<'phone' | 'payees'>('phone')
  const [phone, setPhone] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [filter, setFilter] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [arrival, setArrival] = useState<'instant' | 'standard' | 'next_day'>('instant')
  const flow = useScreenPlan()
  const valid = PHONE.test(phone)
  const lookup = useQuery({
    queryKey: ['directory', phone, lang], queryFn: () => api.directory(phone, lang),
    enabled: valid && !picked, staleTime: 60_000, retry: false,
  })
  const found: Directory | undefined = valid && !picked ? lookup.data : undefined
  const payeeId = picked?.id ?? (found?.kind === 'payee' ? found.payee.id : null)
  const checking = overview.data?.accounts.find((a) => a.kind === 'checking')

  // the people paid most recently, newest first: one tap to pay them again
  const recent = useMemo(() => {
    const seen = new Map<string, Picked>()
    for (const t of transfers.data?.items ?? []) {
      if (!seen.has(t.payee_id)) seen.set(t.payee_id, { id: t.payee_id, name: t.payee, detail: `${t.bank} ****${t.account_tail}` })
    }
    return [...seen.values()].slice(0, 6)
  }, [transfers.data])
  const history = (transfers.data?.items ?? []).filter((t) => t.payee_id === payeeId).slice(0, 8)
  const shown = (payees.data?.items ?? []).filter((p) => !filter || `${p.name}${p.name_en}${p.note ?? ''}`.toLowerCase().includes(filter.toLowerCase()))

  const ready = AMOUNT.test(amount) && Number(amount) > 0 && (picked || found?.kind === 'payee' || found?.kind === 'directory')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    const extra = { ...(memo.trim() ? { memo: memo.trim() } : {}), ...(arrival !== 'instant' ? { arrival } : {}) }
    if (picked) void flow.start('transfer', { payee: picked.id, amount_yuan: Number(amount), ...extra })
    else void flow.start('phone_transfer', { phone, amount_yuan: Number(amount), ...extra })
  }
  const pick = (p: Picked) => { setPicked(p); setPhone('') }
  const again = () => { flow.reset(); setAmount(''); setMemo(''); setArrival('instant') }

  return (
    <main tabIndex={-1} className="page-content">
      <PageHead title={tr('Transfers', '转账')} right={<Link to="/accounts?tab=transfers" className="btn btn-line py-1.5 text-sm">{tr('Where my money is', '到账进度')}</Link>} />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        <section aria-label={tr('New transfer', '新转账')}>
          {flow.planId ? <ScreenConfirm planId={flow.planId} again={tr('Send another', '再转一笔')} onAgain={again} /> : (
            <form onSubmit={submit} className="ruled space-y-5 p-6 max-sm:p-4">
              {!picked && recent.length > 0 && (
                <div>
                  <p className="mb-2 text-sm text-ink2">{tr('Recent', '最近转账')}</p>
                  <div className="tab-scroll flex gap-3">
                    {recent.map((p) => (
                      <button key={p.id} type="button" onClick={() => pick(p)} className="flex w-16 flex-col items-center gap-1 text-center">
                        <Avatar name={p.name} masked={p.name.startsWith('*')} />
                        <span className="w-full truncate text-xs">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {picked ? (
                <div className="flex items-center gap-3 rounded-box bg-paper px-4 py-3">
                  <Avatar name={picked.name} masked={picked.name.startsWith('*')} />
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{picked.name}</span><span className="block text-sm text-ink2">{picked.detail}</span></span>
                  <button type="button" className="text-sm font-semibold text-[var(--action)]" onClick={() => setPicked(null)}>{tr('Change', '换一个')}</button>
                </div>
              ) : <>
                <Segmented label={tr('Send to', '转给')} value={tab} onChange={setTab} options={[['phone', tr('Phone number', '手机号')], ['payees', tr('Payees', '收款人')]] as const} />

                {tab === 'phone' ? (
                  <div>
                    <label className="flex items-center gap-2 rounded-box border border-transparent bg-paper px-4 focus-within:border-[var(--action)]">
                      <span className="font-mono text-ink2">+86</span>
                      <input value={spaced(phone)} onChange={(e) => setPhone(digitsOf(e.target.value))} inputMode="tel" autoComplete="off"
                        placeholder="139 1234 5678" aria-label={tr('Phone number', '手机号')}
                        className="num min-w-0 flex-1 bg-transparent py-3 font-mono text-[1.15rem] tracking-wide outline-none focus-visible:outline-none" />
                    </label>
                    <div className="mt-2 min-h-[3.75rem]" aria-live="polite">
                      {!valid && <p className="px-1 pt-2 text-sm text-ink2">{phone.length ? tr(`${11 - phone.length} more digits`, `还差 ${11 - phone.length} 位`) : tr('Type an 11-digit mobile number: you’ll see whose account it is before you send.', '输入 11 位手机号：转账前先告诉你这是谁的账户。')}</p>}
                      {valid && lookup.isLoading && <div className="h-14 animate-pulse rounded-box bg-paper2" />}
                      {valid && lookup.isError && <p className="text-sm font-semibold text-cinnabar">{tr('Could not look the number up. Try again in a moment.', '暂时查不到这个号码，请稍后再试。')}</p>}
                      {found?.kind === 'payee' && (
                        <div className="flex items-center gap-3 px-1 py-1">
                          <Avatar name={found.payee.name} />
                          <span className="min-w-0"><span className="block font-semibold">{found.payee.name}{found.payee.note && <span className="font-normal text-ink2">（{found.payee.note}）</span>}</span>
                            <span className="block text-sm text-ink2">{found.payee.bank} ****{found.payee.account_tail} · {tr('saved payee', '已保存的收款人')}</span></span>
                        </div>
                      )}
                      {found?.kind === 'directory' && (
                        <div className="flex items-center gap-3 px-1 py-1">
                          <Avatar name={found.name} masked />
                          <span className="min-w-0"><span className="block font-semibold">{found.name}</span>
                            <span className="block text-sm text-ink2">{found.bank}{found.same_bank ? tr(' · our bank, arrives now', ' · 本行客户，实时到账') : ''}</span>
                            <span className="block text-xs font-semibold text-cinnabar">{tr('First transfer to this number: check the name is who you mean.', '第一次转给这个号码：请确认姓名是你要转的人。')}</span></span>
                        </div>
                      )}
                      {found?.kind === 'none' && <p className="px-1 text-sm font-semibold text-cinnabar">{tr("This number isn't linked to a bank account.", '这个号码没有绑定银行账户。')}</p>}
                      {found?.kind === 'self' && <p className="px-1 text-sm text-ink2">{tr('That is your own number.', '这是你自己的号码。')}</p>}
                    </div>
                  </div>
                ) : (
                  <div>
                    <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tr('Search payees', '搜索收款人')} aria-label={tr('Search payees', '搜索收款人')}
                      className="w-full rounded-box border border-rule2 bg-field px-4 py-2.5 outline-none focus:border-[var(--action)]" />
                    <ul className="mt-2 max-h-80 divide-y divide-[var(--rule)] overflow-y-auto rounded-box bg-paper">
                      {shown.map((p) => {
                        const name = lang === 'zh' ? p.name : p.name_en
                        const note = lang === 'zh' ? p.note : p.note_en
                        return (
                          <li key={p.id}>
                            <button type="button" onClick={() => pick({ id: p.id, name, detail: `${lang === 'zh' ? p.bank : p.bank_en} ****${p.account_tail}` })}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-sheet">
                              <Avatar name={name} masked={name.startsWith('*')} />
                              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{name}{note && <span className="font-normal text-ink2"> · {note}</span>}</span>
                                <span className="block text-xs text-ink2">{lang === 'zh' ? p.bank : p.bank_en} ****{p.account_tail} · {p.phone}</span></span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </>}

              <div>
                <label htmlFor="send-amount" className="text-sm text-ink2">{tr('Amount', '金额')}</label>
                <div className="mt-1 flex items-baseline gap-2 border-b-2 border-rule2 focus-within:border-[var(--action)]">
                  <span className="font-mono text-2xl text-ink2">¥</span>
                  <input id="send-amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0" autoComplete="off"
                    className="num min-w-0 flex-1 bg-transparent py-2 font-mono text-[2.2rem] font-bold outline-none focus-visible:outline-none" />
                </div>
                {checking && <p className="mt-1.5 text-sm text-ink2">{tr(`From ${checking.name}: ${yuan(checking.fen)}`, `从${checking.name}付款，余额 ${yuan(checking.fen)}`)}</p>}
              </div>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={40} placeholder={tr('Note (optional)', '备注（可选）')} aria-label={tr('Note', '备注')}
                className="w-full rounded-box border border-rule2 bg-field px-4 py-2.5 outline-none focus:border-[var(--action)]" />
              <div>
                <p className="mb-1.5 text-sm text-ink2">{tr('When should it arrive?', '什么时候到账？')}</p>
                <Segmented stretch className="flex w-full" label={tr('Arrival', '到账时间')} value={arrival} onChange={setArrival}
                  options={[['instant', tr('Now', '实时')], ['standard', tr('In 2 hours', '2 小时后')], ['next_day', tr('Tomorrow', '次日')]] as const} />
                <p className="mt-1.5 text-xs text-ink2">{arrival === 'instant'
                  ? tr('A later arrival gives you time to cancel if something feels wrong.', '选择延时到账，发现不对时还来得及撤销。')
                  : tr('You can cancel it any time before it arrives.', '到账之前随时可以撤销。')}</p>
              </div>
              {flow.error && <p role="alert" className="text-sm font-semibold text-cinnabar">{flow.error}</p>}
              <button className="btn btn-ink w-full py-3 text-base" disabled={!ready || flow.busy}>
                {ready ? tr(`Send ${yuan(Math.round(Number(amount) * 100))}`, `转账 ${yuan(Math.round(Number(amount) * 100))}`) : tr('Send', '转账')}
              </button>
              <p className="text-center text-xs text-ink2">{tr('Over ¥1,000 a day, or over ¥500 to someone new, needs your PIN and a code.', '当天累计超过 ¥1,000，或给新收款人超过 ¥500，需要交易密码和验证码。')}</p>
            </form>
          )}
        </section>

        <section aria-label={tr('Transfers with this person', '与 TA 的转账')} className="rounded-panel bg-[var(--field)] p-6 max-sm:p-4">
          <h2 className="mb-4 text-xl font-bold">{payeeId ? tr('Between you', '与 TA 的转账') : tr('Latest transfers', '最近的转账')}</h2>
          {(() => {
            const rows = payeeId ? history : (transfers.data?.items ?? []).slice(0, 6)
            if (!transfers.data) return <div className="h-40 animate-pulse rounded-box bg-paper2" aria-hidden />
            if (!rows.length) return <p className="py-6 text-center text-sm text-ink2">{payeeId ? tr('No transfers to them yet.', '还没有给 TA 转过账。') : tr('No transfers yet.', '还没有转账。')}</p>
            return (
              <ol className="space-y-2.5">
                {rows.map((t) => (
                  <li key={t.id} className="ml-auto w-fit min-w-[11rem] max-w-[85%] rounded-[18px] rounded-br-md bg-paper px-4 py-2.5 shadow-[0_1px_3px_var(--shadow)]">
                    {!payeeId && <p className="text-xs font-semibold text-ink2">{t.payee}</p>}
                    <p className="num font-mono text-lg font-bold">{yuan(t.fen)}</p>
                    {t.memo && <p className="text-sm">{t.memo}</p>}
                    <p className={`text-xs ${t.status === 'arrived' ? 'text-jade' : t.status === 'returned' ? 'text-cinnabar' : 'text-ink2'}`}>{t.status_label} · {stamp(t.created_at)}</p>
                  </li>
                ))}
              </ol>
            )
          })()}
        </section>
      </div>
    </main>
  )
}

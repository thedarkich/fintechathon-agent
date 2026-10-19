import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLang } from '../i18n'
import { usePlan } from './PlanView'
import { ScreenConfirm, useScreenPlan } from './ScreenPlan'

const FIELD = 'w-full rounded-box border border-rule2 bg-field px-4 py-2.5 outline-none focus:border-[var(--action)]'
const digitsOf = (value: string) => value.replace(/\D/g, '')

/** Add a contact without the assistant: the same contact_add plan, rules and confirm card, started from a form. */
export function AddContactModal({ onClose }: { onClose: () => void }) {
  const { tr } = useLang()
  const qc = useQueryClient()
  const flow = useScreenPlan()
  const plan = usePlan(flow.planId)
  const dialog = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [account, setAccount] = useState('')
  const [bank, setBank] = useState('')
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState('')

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      before?.focus?.({ preventScroll: true })
    }
  }, [onClose])

  const done = plan.data?.status === 'done'
  useEffect(() => { if (done) void qc.invalidateQueries({ queryKey: ['contacts'] }) }, [done, qc])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (flow.busy) return
    if (!name.trim()) return setInvalid(tr('Enter their name.', '请输入姓名。'))
    if (phone && !/^1\d{10}$/.test(phone)) return setInvalid(tr('The phone number must have 11 digits and start with 1.', '手机号需为 11 位，以 1 开头。'))
    if (account && (account.length < 12 || account.length > 19)) return setInvalid(tr('The account number must have 12–19 digits.', '卡号应为 12–19 位数字。'))
    if (!phone && !account) return setInvalid(tr('Enter a phone number or an account number.', '请输入手机号或银行卡号。'))
    setInvalid('')
    void flow.start('contact_add', {
      name: name.trim(), ...(phone && { phone }), ...(account && { account_no: account }),
      ...(bank.trim() && { bank: bank.trim() }), ...(note.trim() && { note: note.trim() }),
    })
  }

  const again = () => { flow.reset(); setName(''); setPhone(''); setAccount(''); setBank(''); setNote('') }
  const error = invalid || flow.error
  return (
    <div className="fixed inset-0 z-40 flex justify-center bg-[rgba(0,0,0,0.55)] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="add-contact-title" tabIndex={-1} className="flex h-full w-full flex-col overflow-hidden bg-field outline-none sm:h-auto sm:max-h-[92dvh] sm:max-w-md sm:rounded-box sm:border sm:border-rule2">
        <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
          <p id="add-contact-title" className="font-semibold">{tr('Add a contact', '添加联系人')}</p>
          <button type="button" onClick={onClose} className="shrink-0 rounded-box px-2 py-1 text-lg text-ink2 hover:bg-paper2" aria-label={tr('Close', '关闭')}>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {flow.planId ? (
            <ScreenConfirm planId={flow.planId} again={tr('Add another', '再添加一个')} onAgain={again} />
          ) : (
            <form onSubmit={submit} noValidate className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoComplete="off"
                placeholder={tr('Name', '姓名')} aria-label={tr('Name', '姓名')} className={FIELD} />
              <label className="flex items-center gap-2 rounded-box border border-rule2 bg-field px-4 focus-within:border-[var(--action)]">
                <span className="font-mono text-ink2">+86</span>
                <input value={phone} onChange={(e) => setPhone(digitsOf(e.target.value).slice(0, 11))} inputMode="tel" autoComplete="off"
                  placeholder={tr('Phone number', '手机号')} aria-label={tr('Phone number', '手机号')}
                  className="num min-w-0 flex-1 bg-transparent py-2.5 font-mono outline-none focus-visible:outline-none" />
              </label>
              <input value={account} onChange={(e) => setAccount(digitsOf(e.target.value).slice(0, 19))} inputMode="numeric" autoComplete="off"
                placeholder={tr('Account number (optional if you gave a phone)', '银行卡号（填了手机号可不填）')} aria-label={tr('Account number', '银行卡号')} className={`${FIELD} num font-mono`} />
              <input value={bank} onChange={(e) => setBank(e.target.value)} maxLength={20} autoComplete="off"
                placeholder={tr('Bank (optional)', '开户银行（可选）')} aria-label={tr('Bank', '开户银行')} className={FIELD} />
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={40} autoComplete="off"
                placeholder={tr('Note, e.g. family (optional)', '备注，如：家人（可选）')} aria-label={tr('Note', '备注')} className={FIELD} />
              {error && <p role="alert" className="text-sm font-semibold text-cinnabar">{error}</p>}
              <button className="btn btn-ink w-full py-3 text-base" disabled={flow.busy}>{flow.busy ? tr('Please wait…', '请稍候…') : tr('Continue', '下一步')}</button>
              <p className="text-center text-xs text-ink2">{tr('You confirm on the next step. For 24 hours, large payments to a new contact need your PIN and a code.', '下一步确认后添加。新联系人 24 小时内的大额付款需要交易密码和验证码。')}</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

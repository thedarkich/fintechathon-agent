import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Fingerprint, MessageSquareText, ShieldCheck } from 'lucide-react'
import { api, errorText } from '../api/client'
import type { Plan } from '../api/types'
import { useLang } from '../i18n'
import { useAuth } from '../lib/auth'
import { useChat } from '../lib/chat'
import { assertPasskey, passkeysSupported } from '../lib/passkey'

/** The simulated phone's SMS inbox. A real bank sends these to the customer's phone. */
export function usePhone(enabled: boolean) {
  return useQuery({ queryKey: ['phone'], queryFn: api.phone, refetchInterval: enabled ? 2500 : false, enabled })
}

/**
 * Strong verification for red steps: the 6-digit PIN plus an SMS code or a passkey.
 * A modal over the page, like every other detail window here. The assistant never sees what is typed here.
 */
export function VerifyDialog({ plan, hasPasskey, onClose }: { plan: Plan; hasPasskey: boolean; onClose: () => void }) {
  const { tr, lang } = useLang()
  const { apply } = useChat()
  const { user } = useAuth()
  const canPasskey = hasPasskey && passkeysSupported()
  const [method, setMethod] = useState<'sms' | 'passkey'>(canPasskey ? 'passkey' : 'sms')
  const [pin, setPin] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<{ challenge_id: string; phone: string } | null>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const phone = usePhone(!!challenge)
  const dialog = useRef<HTMLFormElement>(null)
  const needs = plan.steps.some((s) => s.action === 'password_change' && s.status === 'pending') ? 'new_password'
    : plan.steps.some((s) => s.action === 'pin_change' && s.status === 'pending') ? 'new_pin' : null

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      before?.focus?.({ preventScroll: true })
    }
  }, [onClose])

  async function sendCode() {
    setError('')
    try {
      setChallenge(await api.sms(plan.id))
    } catch (err) {
      setError(errorText(err, lang))
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body: Record<string, unknown> = { approval_hash: plan.approval_hash, pin, method, lang }
      if (needs) body[needs] = secret
      if (method === 'sms') {
        body.challenge_id = challenge?.challenge_id
        body.code = code
      } else {
        body.credential = await assertPasskey(await api.passkeyOptions(plan.id))
      }
      apply(await api.verify(plan.id, body))
      onClose()
    } catch (err) {
      setError(err instanceof DOMException ? tr('The passkey check was cancelled.', '通行密钥验证已取消。') : errorText(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const latest = phone.data?.items[0]
  const ready = pin.length === 6 && (method === 'passkey' || (!!challenge && code.length === 6)) && (!needs || secret.length >= (needs === 'new_pin' ? 6 : 10))
  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/50 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={dialog} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="verify-title" className="flex h-full w-full flex-col overflow-hidden bg-[var(--card)] outline-none sm:h-auto sm:max-h-[92dvh] sm:max-w-lg sm:rounded-box sm:border-[1.5px] sm:border-rule2">
        <div className="flex items-start justify-between gap-3 border-b-[1.5px] border-rule2 px-4 py-3">
          <div className="min-w-0">
            <p id="verify-title" className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-cinnabar" />{tr('Strong verification', '强验证')}</p>
            <p className="text-xs text-ink2">{tr('Two checks: your PIN, and your phone or passkey. The assistant never sees them.', '两项验证：交易密码，以及手机验证码或通行密钥。助手看不到这些信息。')}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-box px-2 py-1 text-lg text-ink2 hover:bg-paper2" aria-label={tr('Close', '关闭')}>✕</button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <label className="auth-field !mb-0" htmlFor="verify-pin">{tr('Transaction PIN', '交易密码')}
            <input id="verify-pin" className="num text-center !text-xl tracking-[0.6em]" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label>
          {user?.demo_pin && (
            <p className="-mt-3 flex items-center justify-between gap-2 text-xs text-ink2">
              {tr(`Demo account: the PIN is ${user.demo_pin}`, `演示账户：交易密码是 ${user.demo_pin}`)}
              <button type="button" className="font-semibold text-[var(--action)]" onClick={() => setPin(user.demo_pin ?? '')}>{tr('Fill it in', '填入')}</button>
            </p>
          )}

          {needs && (
            <label className="auth-field !mb-0" htmlFor="verify-secret">{needs === 'new_pin' ? tr('New 6-digit PIN', '新的 6 位交易密码') : tr('New login password (10+ characters)', '新的登录密码（至少 10 位）')}
              <input id="verify-secret" type="password" autoComplete="new-password" inputMode={needs === 'new_pin' ? 'numeric' : undefined}
                value={secret} onChange={(e) => setSecret(needs === 'new_pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} />
            </label>
          )}

          <fieldset>
            <legend className="text-xs font-semibold">{tr('Second check', '第二重验证')}</legend>
            <div className="auth-tabs !my-2">
              <button type="button" aria-pressed={method === 'sms'} onClick={() => setMethod('sms')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-2 text-cap ${method === 'sms' ? 'bg-[var(--card)] font-semibold text-[var(--action)] shadow-[0_1px_3px_var(--shadow)]' : 'text-ink2'}`}>
                <MessageSquareText size={15} />{tr('SMS code', '短信验证码')}
              </button>
              <button type="button" aria-pressed={method === 'passkey'} disabled={!canPasskey} onClick={() => setMethod('passkey')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 py-2 text-cap disabled:opacity-40 ${method === 'passkey' ? 'bg-[var(--card)] font-semibold text-[var(--action)] shadow-[0_1px_3px_var(--shadow)]' : 'text-ink2'}`}>
                <Fingerprint size={15} />{tr('Passkey', '通行密钥')}
              </button>
            </div>
            {!canPasskey && <p className="text-xs text-ink2">{tr('Add a passkey (face or fingerprint unlock) under Cards → Security to use it here.', '在“卡片 → 安全”里添加通行密钥（面容或指纹解锁）后可在此使用。')}</p>}
          </fieldset>

          {method === 'sms' && (
            !challenge ? (
              <button type="button" className="btn btn-line w-full py-2" onClick={() => void sendCode()}>{tr('Send a code to my phone', '发送验证码到我的手机')}</button>
            ) : (
              <div>
                <label className="auth-field !mb-0" htmlFor="verify-code">{tr(`Code sent to ${challenge.phone}`, `验证码已发送至 ${challenge.phone}`)}
                  <input id="verify-code" className="num text-center !text-xl tracking-[0.6em]" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                </label>
                {latest && (
                  <div className="mt-3 rounded-box bg-[var(--field)] px-3 py-2 text-cap">
                    <p className="text-xs font-semibold text-ink2">{tr('Simulated phone (demo only)', '模拟手机短信（仅演示）')}</p>
                    <p className="mt-1">{lang === 'zh' ? latest.text : latest.text_en}</p>
                  </div>
                )}
              </div>
            )
          )}
          {error && <p className="auth-message" role="alert">{error}</p>}
        </div>
        <div className="border-t border-rule px-4 py-3 sm:px-6">
          <button className="site-button auth-submit" disabled={!ready || busy}>{busy ? tr('Checking…', '验证中…') : tr('Verify and confirm', '验证并确认')} <span aria-hidden>→</span></button>
        </div>
      </form>
    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Fingerprint, MessageSquareText, ShieldCheck, X } from 'lucide-react'
import { useLang } from '../i18n'
import { call, errorText, type Plan, type PlanResult } from '../lib/api'
import { useChat } from '../lib/chat'
import { passkeysSupported, assertPasskey } from '../lib/passkey'
import { useOverview } from '../pages/Shell'

interface Sms { id: string; at: string; text: string; text_en: string }

/** The simulated phone's latest SMS, shown inside the dialog so the demo works on one screen. */
export function usePhone(enabled: boolean) {
  return useQuery({ queryKey: ['phone'], queryFn: () => call<{ number: string; items: Sms[] }>('/api/phone'), refetchInterval: enabled ? 2500 : false, enabled })
}

export function VerifySheet({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { tr, lang } = useLang()
  const { apply } = useChat()
  const overview = useOverview()
  const canPasskey = !!overview.data?.has_passkey && passkeysSupported()
  const [method, setMethod] = useState<'sms' | 'passkey'>(canPasskey ? 'passkey' : 'sms')
  const [pin, setPin] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<{ challenge_id: string; phone: string } | null>(null)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const phone = usePhone(!!challenge)
  const pinRef = useRef<HTMLInputElement>(null)
  const needs = plan.steps.some((s) => s.action === 'password_change' && s.status === 'pending') ? 'new_password'
    : plan.steps.some((s) => s.action === 'pin_change' && s.status === 'pending') ? 'new_pin' : null
  useEffect(() => { pinRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function sendCode() {
    setError('')
    try {
      setChallenge(await call(`/api/plans/${plan.id}/sms`, {}))
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
        const options = await call(`/api/plans/${plan.id}/passkey-options`, {})
        body.credential = await assertPasskey(options)
      }
      apply(await call<PlanResult>(`/api/plans/${plan.id}/verify`, body))
      onClose()
    } catch (err) {
      setError(err instanceof DOMException ? tr('The passkey check was cancelled.', '通行密钥验证已取消。') : errorText(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const latest = phone.data?.items[0]
  const ready = pin.length === 6 && (method === 'passkey' || (challenge && code.length === 6)) && (!needs || secret.length >= (needs === 'new_pin' ? 6 : 10))
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,18,32,.45)] sm:items-center" role="dialog" aria-modal="true" aria-labelledby="verify-title">
      <form onSubmit={submit} className="safe-bottom max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-sheet p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="verify-title" className="flex items-center gap-2 text-lg font-bold"><ShieldCheck size={20} className="text-vermilion" />{tr('Strong verification', '强验证')}</h2>
            <p className="mt-1 text-sm text-ink2">{tr('This is high risk, so the bank checks two things: your PIN and your phone or passkey. The assistant never sees them.', '这是高风险操作，需要验证两项：交易密码，以及手机验证码或通行密钥。助手看不到这些信息。')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink2" aria-label={tr('Close', '关闭')}><X size={20} /></button>
        </div>

        <label className="mt-5 block text-sm font-semibold">{tr('Transaction PIN', '交易密码')}
          <input ref={pinRef} className="field num mt-1.5 text-center text-xl tracking-[0.6em]" type="password" inputMode="numeric" autoComplete="off"
            maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-describedby="pin-hint" />
          <span id="pin-hint" className="mt-1 block text-xs font-normal text-ink3">{tr('6 digits', '6 位数字')}</span>
        </label>

        {needs && (
          <label className="mt-4 block text-sm font-semibold">{needs === 'new_pin' ? tr('New 6-digit PIN', '新的 6 位交易密码') : tr('New login password (10+ characters)', '新的登录密码（至少 10 位）')}
            <input className="field mt-1.5 font-normal" type="password" autoComplete="new-password" inputMode={needs === 'new_pin' ? 'numeric' : undefined}
              value={secret} onChange={(e) => setSecret(needs === 'new_pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} />
          </label>
        )}

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold">{tr('Second check', '第二重验证')}</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={method === 'sms'} onClick={() => setMethod('sms')}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${method === 'sms' ? 'border-indigo bg-indigo-wash text-indigo' : 'border-rule text-ink2'}`}>
              <MessageSquareText size={16} />{tr('SMS code', '短信验证码')}
            </button>
            <button type="button" aria-pressed={method === 'passkey'} disabled={!canPasskey} onClick={() => setMethod('passkey')}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40 ${method === 'passkey' ? 'border-indigo bg-indigo-wash text-indigo' : 'border-rule text-ink2'}`}>
              <Fingerprint size={16} />{tr('Passkey', '通行密钥')}
            </button>
          </div>
          {!canPasskey && <p className="mt-1.5 text-xs text-ink3">{tr('Add a passkey (face or fingerprint unlock) under More → Security to use it here.', '在“更多 → 安全”中添加通行密钥（面容或指纹解锁）后可在此使用。')}</p>}
        </fieldset>

        {method === 'sms' && (
          <div className="mt-4">
            {!challenge ? (
              <button type="button" className="btn btn-quiet w-full" onClick={sendCode}>{tr('Send code to my phone', '发送验证码到我的手机')}</button>
            ) : (
              <>
                <label className="block text-sm font-semibold">{tr(`Code sent to ${challenge.phone}`, `验证码已发送至 ${challenge.phone}`)}
                  <input className="field num mt-1.5 text-center text-xl tracking-[0.6em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                </label>
                {latest && (
                  <div className="mt-3 rounded-xl bg-well px-3 py-2.5 text-xs text-ink2">
                    <p className="font-semibold text-ink">{tr('Simulated phone (demo only)', '模拟手机短信（仅演示）')}</p>
                    <p className="mt-1">{lang === 'zh' ? latest.text : latest.text_en}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg bg-vermilion-wash px-3 py-2 text-sm text-vermilion">{error}</p>}
        <button className="btn btn-primary mt-5 w-full" disabled={!ready || busy}>{busy ? tr('Checking…', '验证中…') : tr('Verify and run', '验证并执行')}</button>
      </form>
    </div>
  )
}

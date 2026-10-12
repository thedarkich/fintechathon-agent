import { useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CardView } from '../components/Cards'
import { Empty, LangSwitch, Section, ThemeSwitch } from '../components/Chrome'
import { usePhone } from '../components/Verify'
import { useLang } from '../i18n'
import { call, errorText } from '../lib/api'
import { useAuth } from '../lib/auth'
import { yuan } from '../lib/format'
import { createPasskey, passkeysSupported } from '../lib/passkey'
import { useOverview } from './Shell'

function Unlock() {
  const { tr, lang } = useLang()
  const qc = useQueryClient()
  const [pin, setPin] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const phone = usePhone(!!challenge)
  const send = async () => {
    try { setChallenge((await call<{ challenge_id: string }>('/api/unlock/sms', {})).challenge_id) } catch (err) { setMessage(errorText(err, lang)) }
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await call('/api/unlock', { pin, challenge_id: challenge, code, lang })
      setMessage(tr('Unlocked.', '已解除。'))
      void qc.invalidateQueries()
    } catch (err) {
      setMessage(errorText(err, lang))
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <input className="field num tracking-[0.4em]" type="password" inputMode="numeric" maxLength={6} placeholder={tr('Transaction PIN', '交易密码')} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-label={tr('Transaction PIN', '交易密码')} />
      {!challenge ? <button type="button" className="btn btn-quiet w-full" onClick={send}>{tr('Send code to my phone', '发送验证码到我的手机')}</button> : (
        <>
          <input className="field num tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder={tr('SMS code', '短信验证码')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label={tr('SMS code', '短信验证码')} />
          {phone.data?.items[0] && <p className="rounded-lg bg-well px-3 py-2 text-xs text-ink2">{tr('Simulated phone: ', '模拟手机：')}{lang === 'zh' ? phone.data.items[0].text : phone.data.items[0].text_en}</p>}
          <button className="btn btn-primary w-full" disabled={pin.length !== 6 || code.length !== 6}>{tr('Verify and unlock', '验证并解除')}</button>
        </>
      )}
      {message && <p role="status" className="text-sm text-ink2">{message}</p>}
    </form>
  )
}

export default function More() {
  const { tr, lang } = useLang()
  const { user, logout } = useAuth()
  const overview = useOverview()
  const location = useLocation()
  const qc = useQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subs = useQuery({ queryKey: ['subscriptions', lang], queryFn: () => call<any>(`/api/bank/subscriptions?lang=${lang}`) })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scheduled = useQuery({ queryKey: ['scheduled'], queryFn: () => call<any>('/api/bank/scheduled') })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payees = useQuery({ queryKey: ['payees'], queryFn: () => call<any>('/api/bank/payees') })
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: () => call<{ items: { id: string; label: string; created_at: string }[] }>('/api/passkeys') })
  const [keyMessage, setKeyMessage] = useState('')
  useEffect(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView() }, [location.hash])

  async function addPasskey() {
    setKeyMessage('')
    try {
      const options = await call('/api/passkeys/options', {})
      const credential = await createPasskey(options)
      await call('/api/passkeys', { credential, label: navigator.platform || 'device' })
      setKeyMessage(tr('Passkey added. You can now use it instead of an SMS code.', '通行密钥已添加，之后可以代替短信验证码使用。'))
      void qc.invalidateQueries({ queryKey: ['passkeys'] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
    } catch (err) {
      setKeyMessage(err instanceof DOMException ? tr('Passkey setup was cancelled.', '已取消添加通行密钥。') : errorText(err, lang))
    }
  }

  const locks = overview.data?.locks ?? []
  return (
    <div className="px-4 pb-10 pt-5">
      <h1 className="text-2xl font-extrabold tracking-tight">{tr('More', '更多')}</h1>

      <Section title={tr('Subscriptions and direct debits', '自动续费与代扣')}>
        {subs.data ? <CardView card={{ type: 'subscriptions', ...subs.data }} /> : null}
      </Section>

      <Section title={tr('Scheduled transfers', '预约转账')}>
        {!scheduled.data?.transfers.length ? <Empty>{tr('Nothing scheduled. Try “send Mom 500 every month on the 15th”.', '暂无预约。试试“每月15号给妈妈转500”。')}</Empty> : (
          <ul className="divide-y divide-[var(--rule)] rounded-2xl border border-rule bg-sheet px-4">
            {scheduled.data.transfers.map((s: { id: string; payee: string; fen: number; run_at: string; repeat: string; status: string }) => (
              <li key={s.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>{s.payee}<span className="block text-xs text-ink3">{s.run_at.slice(0, 16).replace('T', ' ')}{s.repeat === 'monthly' ? tr(', monthly', '，每月') : ''}, {s.status}</span></span>
                <span className="num font-semibold">{yuan(s.fen)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={tr('Split bills', 'AA 收款')}>
        {!scheduled.data?.collections.length ? <Empty>{tr('No split bills yet.', '还没有 AA 收款。')}</Empty> : (
          <ul className="divide-y divide-[var(--rule)] rounded-2xl border border-rule bg-sheet px-4">
            {scheduled.data.collections.map((c: { id: string; title: string; total_fen: number; status: string; participants: { name: string; status: string; share_fen: number }[] }) => (
              <li key={c.id} className="py-2.5 text-sm">
                <p className="flex justify-between gap-3"><span className="font-semibold">{c.title}</span><span className="num">{yuan(c.total_fen)}</span></p>
                <p className="text-xs text-ink3">{c.participants.map((p) => `${p.name} ${p.status === 'paid' ? tr('paid', '已付') : tr('pending', '未付')}`).join(', ')}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={tr('Payees', '收款人')}>
        <ul className="divide-y divide-[var(--rule)] rounded-2xl border border-rule bg-sheet px-4">
          {payees.data?.items.map((p: { id: string; name: string; name_en: string; note: string | null; bank: string; account_tail: string; phone: string }) => (
            <li key={p.id} className="py-2.5 text-sm">
              <p className="font-semibold">{lang === 'zh' ? p.name : `${p.name_en} ${p.name}`}{p.note && <span className="ml-2 font-normal text-ink3">{p.note}</span>}</p>
              <p className="num text-xs text-ink3">{p.bank} ****{p.account_tail}, {p.phone}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={tr('Security', '安全')}>
        <div id="security" className="space-y-3">
          <div className="rounded-2xl border border-rule bg-sheet p-4">
            <p className="font-semibold">{tr('Safety lock', '安全锁')}</p>
            {locks.length === 0 ? <p className="mt-1 text-sm text-ink2">{tr('No lock is on. Repeated failed checks or attempts to get around the rules turn one on automatically.', '当前没有安全锁。多次验证失败或试图绕过规则时会自动开启。')}</p> : (
              <>
                {locks.map((l) => <p key={l.reason} className="mt-1 text-sm text-vermilion">{l.text}</p>)}
                {locks.some((l) => l.scope !== 'red') && <Unlock />}
              </>
            )}
          </div>
          <div className="rounded-2xl border border-rule bg-sheet p-4">
            <p className="font-semibold">{tr('Passkeys', '通行密钥')}</p>
            <p className="mt-1 text-sm text-ink2">{tr("Use your phone's face or fingerprint unlock, or a security key, instead of an SMS code for high-risk actions.", '高风险操作时，可用手机的面容/指纹解锁或安全密钥代替短信验证码。')}</p>
            {keys.data?.items.map((k) => <p key={k.id} className="num mt-1 text-xs text-ink3">{k.label || tr('Device', '设备')}, {k.created_at.slice(0, 10)}</p>)}
            <button className="btn btn-quiet mt-3" disabled={!passkeysSupported()} onClick={() => void addPasskey()}>{tr('Add a passkey', '添加通行密钥')}</button>
            {!passkeysSupported() && <p className="mt-1 text-xs text-ink3">{tr('Passkeys need HTTPS and a supported browser.', '通行密钥需要 HTTPS 和支持的浏览器。')}</p>}
            {keyMessage && <p className="mt-2 text-sm text-ink2">{keyMessage}</p>}
          </div>
        </div>
      </Section>

      <Section title={tr('Settings', '设置')}>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-sheet p-4">
          <LangSwitch /><ThemeSwitch />
          <span className="flex-1 text-sm text-ink2">{user?.email}</span>
          {user?.operator && <Link to="/operator" className="text-sm font-semibold text-indigo">{tr('Operator console', '客服工作台')}</Link>}
          <button className="btn btn-quiet" onClick={() => void logout()}>{tr('Sign out', '退出登录')}</button>
        </div>
      </Section>
    </div>
  )
}
